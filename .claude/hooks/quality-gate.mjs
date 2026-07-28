#!/usr/bin/env node
// TaskCompleted gate: runs `pnpm run qa` and blocks completion (exit 2) if it fails. The message
// carries the tail of qa's own output — turbo runs with `--output-logs=errors-only`, so that is
// already just the failing checks.

import { spawnSync } from 'node:child_process';
import { readInput, block, allow } from './hooklib.mjs';
import { acquireLock, releaseLock } from './lock.mjs';

const TAIL_CHARS = 4000;

function main() {
  // SELF-DESCENT GUARD, before anything else so there is no lock to unwind. `pnpm run qa` ends in
  // `test:hooks`, which spawns this hook again. The lock serialises peers; this stops recursion.
  if (process.env.CLAUDE_HOOK_QA_NESTED) allow();

  let input;
  try {
    input = readInput();
  } catch {
    input = { taskSubject: '' };
  }

  const cwd = process.env.CLAUDE_PROJECT_DIR;
  if (!cwd) block('quality-gate: CLAUDE_PROJECT_DIR not set — cannot run QA, failing closed.');

  // Every subagent completion fires a full-monorepo turbo run, contending on the turbo cache.
  // `name` is NOT the pipeline's lock, which it also holds at the repo root on root-level edits.
  // `staleMs` sits above this site's 600s harness timeout; `waitMs: 0` refuses rather than queues.
  const lock = acquireLock(cwd, { name: 'claude-qa.lock', waitMs: 0, staleMs: 900_000 });
  if (!lock) block('Another quality gate is already running; re-run when it completes.');

  let result;
  try {
    result = spawnSync('pnpm', ['run', 'qa'], {
      cwd,
      encoding: 'utf8',
      // Marks the descent for the gate `test:hooks` will spawn. See the guard in main().
      env: { ...process.env, CLAUDE_HOOK_QA_NESTED: '1' },
      // Full-monorepo output exceeds spawnSync's 1MB default and would ENOBUFS.
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    releaseLock(lock);
  }

  if (result.status === 0) allow();

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();

  block(
    [
      `QA failed. Fix before completing: ${input.taskSubject}`,
      '',
      output.slice(-TAIL_CHARS) || '(qa produced no output)',
      '',
      'Re-run in full with: pnpm run qa',
    ].join('\n'),
  );
}

main();
