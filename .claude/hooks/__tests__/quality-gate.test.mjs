// The gate is the sole test signal, so what it SAYS when qa fails is load-bearing. The real
// `pnpm run qa` is never invoked: each case points the hook at a scratch project instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runHook, HOOKS_DIR } from './helpers.mjs';
import { acquireLock, releaseLock } from '../lock.mjs';

const REPO_ROOT = resolve(HOOKS_DIR, '..', '..');

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
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: project.dir } });
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
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: project.dir } });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /QA failed/);
  } finally {
    project.cleanup();
  }
});

// -------------------------------------------------------------------------------- the qa lock

// Refusing is correct: TaskCompleted must not pass unverified, and the alternative is a second
// concurrent full-monorepo turbo run.
test('a second concurrent quality-gate is refused', () => {
  const held = acquireLock(REPO_ROOT, { name: 'claude-qa.lock', waitMs: 0, staleMs: 900_000 });
  assert.ok(held, 'precondition: the test holds the qa lock');

  try {
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: REPO_ROOT } });
    assert.equal(res.status, 2, 'a busy gate must block, never pass unverified');
    assert.match(res.stderr, /another quality gate is already running/i);
    // Two subagents in lockstep can ping-pong refusals; the way out is the agent's own retry.
    assert.match(res.stderr, /re-run when it completes/i);
  } finally {
    releaseLock(held);
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
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: project.dir } });
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
  const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: '' } });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /failing closed/);
});

// A leaked lock would refuse every subsequent completion until staleMs (fifteen minutes) elapsed.
test('the qa lock is released even when qa fails', () => {
  const project = makeScratchProject('exit 1');
  try {
    const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: project.dir } });
    assert.equal(res.status, 2, 'a failing qa must block completion');
    assert.ok(
      !existsSync(join(project.dir, 'node_modules', '.cache', 'claude-qa.lock')),
      'the lock must be gone once the gate has reported',
    );
  } finally {
    project.cleanup();
  }
});
