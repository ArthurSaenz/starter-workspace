// The gate is the sole test signal, so what it SAYS when qa fails is load-bearing. The real
// `pnpm run qa` is never invoked: each case points the hook at a scratch project instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runHook, HOOKS_DIR } from './helpers.mjs';
import { acquireLock, releaseLock } from '../lock.mjs';

const REPO_ROOT = resolve(HOOKS_DIR, '..', '..');

// The gate skips itself when CLAUDE_HOOK_QA_NESTED is set, and `helpers.mjs` merges `process.env` —
// so when `test:hooks` runs UNDER a real gate, every case here would inherit the flag and see a
// no-op. Blank it explicitly wherever the gate is expected to do real work. Empty string is falsy,
// so the guard stays off.
const gateEnv = (extra) => ({ CLAUDE_HOOK_QA_NESTED: '', ...extra });

// MUST carry its own package.json: `pnpm run qa` walks upward, so a bare directory would find the
// repo root's script and launch the full-monorepo run these tests exist to avoid.
function makeScratchProject(qaScript) {
  const dir = join(REPO_ROOT, '.omc', `.tmp-qa-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp-qa', version: '0.0.0', scripts: { qa: qaScript } }),
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The whole point of capturing qa's output instead of letting it stream.
test("a failing qa reports the check's own output, not a generic sentence", () => {
  const project = makeScratchProject('echo "src/x.ts(4,7): error TS2322: nope" && exit 1');
  try {
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: gateEnv({ CLAUDE_PROJECT_DIR: project.dir }) });
    assert.equal(res.status, 2, 'a failing qa must block completion');
    assert.match(res.stderr, /TS2322/, "the failing check's own output must reach the agent");
    assert.match(res.stderr, /pnpm run qa/, 'and it must say how to re-run the whole thing');
  } finally {
    project.cleanup();
  }
});

test('a qa failure with no output still produces a usable message', () => {
  const project = makeScratchProject('exit 1');
  try {
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: gateEnv({ CLAUDE_PROJECT_DIR: project.dir }) });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /QA failed/);
  } finally {
    project.cleanup();
  }
});

// -------------------------------------------------------------------------------- the qa lock

// Refusing is correct: TaskCompleted must not pass unverified, and the alternative is a second
// concurrent full-monorepo turbo run.
//
// CONTENDS IN A SCRATCH PROJECT, NEVER AT THE REPO ROOT. A live TaskCompleted gate holds
// `claude-qa.lock` at the repo root for its whole run, and `qa` ends in `test:hooks` — so a
// root-level acquire here failed its own precondition every time the real gate ran it, and the
// gate reported that as a QA failure. Scratch keeps the meaning and drops the collision.
test('a second concurrent quality-gate is refused', () => {
  const project = makeScratchProject('echo scratch-qa-ok');
  const held = acquireLock(project.dir, { name: 'claude-qa.lock', waitMs: 0, staleMs: 900_000 });
  assert.ok(held, 'precondition: the test holds the qa lock');

  try {
    const res = runHook(
      'quality-gate.mjs',
      { tool_name: 'Stop' },
      { env: gateEnv({ CLAUDE_PROJECT_DIR: project.dir }) },
    );
    assert.equal(res.status, 2, 'a busy gate must block, never pass unverified');
    assert.match(res.stderr, /another quality gate is already running/i);
    // Two subagents in lockstep can ping-pong refusals; the way out is the agent's own retry.
    assert.match(res.stderr, /re-run when it completes/i);
  } finally {
    releaseLock(held);
    project.cleanup();
  }
});

// The CLASS behind that instance. `qa` ends in `test:hooks`, so any test taking the gate's own lock
// name at the repo root breaks whenever a real gate is the thing running it. Scans sources rather
// than hardcoding a list, so a new test file cannot reintroduce it unnoticed.
test('no test contends on the gate lock at the repo root', () => {
  const dir = import.meta.dirname;

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.test.mjs'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    const offenders = [...source.matchAll(/acquireLock\(\s*REPO_ROOT[\s\S]*?\)/g)].filter((match) =>
      match[0].includes('claude-qa.lock'),
    );

    assert.equal(
      offenders.length,
      0,
      `${file} acquires the gate's lock at the repo root — use makeScratchProject() instead`,
    );
  }
});

// The depth guard, which is what stops `gate -> qa -> test:hooks -> gate` from recursing. Distinct
// from the lock: the lock serialises peers, this stops self-descent.
// The scratch qa FAILS on purpose: a passing one produces no gate output, so the assertions below
// would hold whether or not the guard exists. Failing makes the difference observable — unguarded,
// the gate blocks with the marker in its report.
test('a nested gate returns without running qa at all', () => {
  const project = makeScratchProject('echo NESTED_QA_MUST_NOT_RUN && exit 1');
  try {
    const res = runHook(
      'quality-gate.mjs',
      { tool_name: 'Stop' },
      { env: { CLAUDE_PROJECT_DIR: project.dir, CLAUDE_HOOK_QA_NESTED: '1' } },
    );
    assert.equal(res.status, 0, 'a nested gate must not block the outer completion');
    assert.doesNotMatch(
      `${res.stdout}${res.stderr}`,
      /NESTED_QA_MUST_NOT_RUN/,
      'and must not spawn qa — the marker proves the script never ran',
    );
    assert.ok(
      !existsSync(join(project.dir, 'node_modules', '.cache', 'claude-qa.lock')),
      'a nested gate must not leave a lock behind either',
    );
  } finally {
    project.cleanup();
  }
});

// THE REGRESSION THIS CATCHES: editing `.claude/hooks/*.mjs` makes the edit pipeline hold a
// repo-root lock, so a shared filename would let a prettier stage refuse a task completion.
test('a quality-gate is NOT refused while the pipeline holds the repo-root lock', () => {
  const project = makeScratchProject('exit 1');
  // The lock the EDIT PIPELINE would hold, in the same directory, under its own name.
  const pipelineLock = acquireLock(project.dir, { waitMs: 0, staleMs: 120_000 });
  assert.ok(pipelineLock, 'precondition: the pipeline holds the lock in this directory');

  try {
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: gateEnv({ CLAUDE_PROJECT_DIR: project.dir }) });
    // Free to fail on qa itself; what it must NOT do is refuse on the lock.
    assert.doesNotMatch(
      res.stderr,
      /another quality gate is already running/i,
      'the pipeline lock and the qa lock must be independent files',
    );
  } finally {
    releaseLock(pipelineLock);
    project.cleanup();
  }
});

test('quality-gate fails closed when CLAUDE_PROJECT_DIR is unset (exit 2)', () => {
  const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: gateEnv({ CLAUDE_PROJECT_DIR: '' }) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /failing closed/);
});

// A leaked lock would refuse every subsequent completion until staleMs (fifteen minutes) elapsed.
test('the qa lock is released even when qa fails', () => {
  const project = makeScratchProject('exit 1');
  try {
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: gateEnv({ CLAUDE_PROJECT_DIR: project.dir }) });
    assert.equal(res.status, 2, 'a failing qa must block completion');
    assert.ok(
      !existsSync(join(project.dir, 'node_modules', '.cache', 'claude-qa.lock')),
      'the lock must be gone once the gate has reported',
    );
  } finally {
    project.cleanup();
  }
});
