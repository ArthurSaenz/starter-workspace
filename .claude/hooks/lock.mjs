// Advisory file lock for hooks that must not run concurrently with themselves. Node stdlib only.
//
// Protects the per-package tsbuildinfo and the source files `prettier --write` / `eslint --fix`
// rewrite WHOLE — two whole-file rewrites interleaving on one path lose the user's source.
//
// STALE-STEAL IS THE PRIMARY CORRECTNESS MECHANISM. `releaseLock` in a `finally` is only a latency
// optimization, since `finally` does not run on the SIGKILL the harness sends at its timeout.

import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// There is no stdlib sync sleep, and a spin loop would fight the tool processes for the same core.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Unreadable => ABSENT, not fatal: the writer died mid-acquire, which is what steal exists to clear.
function readRecord(path) {
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof record?.nonce !== 'string') return null;
    return record;
  } catch {
    return null;
  }
}

// `process.kill(pid, 0)` sends no signal, it only asks whether the pid is signalable. ESRCH means
// gone (steal); EPERM means alive under another user, so NOT stale.
function isStale(record, staleMs) {
  if (!record || typeof record.pid !== 'number' || typeof record.startedAt !== 'number') return true;
  if (Date.now() - record.startedAt > staleMs) return true;

  try {
    process.kill(record.pid, 0);
  } catch (err) {
    if (err.code === 'ESRCH') return true;
  }

  return false;
}

// Displace an apparently-stale holder. True => restart the acquire loop; false => holder is healthy.
//
// `onClaimed` is a TEST SEAM: the mismatch branch needs a healthy holder to acquire inside the
// two-syscall window below, which cannot be raced reliably nor reproduced single-threaded.
export function trySteal(lockPath, staleMs, { onClaimed } = {}) {
  const observedBefore = readRecord(lockPath);
  if (!isStale(observedBefore, staleMs)) return false;

  // Our OWN fresh nonce, never the observed one: with the observed nonce two stealers rename to the
  // same target, and POSIX rename-over-existing succeeds silently — so both believe they won.
  const claim = `${lockPath}.steal.${randomUUID()}`;

  try {
    renameSync(lockPath, claim);
  } catch (err) {
    if (err.code === 'ENOENT') return true; // another contender moved it first; let `wx` decide
    throw err;
  }

  let restored = false;

  try {
    onClaimed?.(claim);
    const observedAfter = readRecord(claim);

    // RESTORE, never unlink. If a healthy holder acquired in the gap, the record we moved is THEIRS
    // — unlinking leaves them running while a fresh `wx` succeeds against the empty path.
    // `?.nonce` both sides: garbage equals garbage, so it is stolen rather than restored forever.
    if (observedAfter?.nonce !== observedBefore?.nonce) {
      renameSync(claim, lockPath);
      restored = true;
    }

    return true;
  } finally {
    if (!restored) rmSync(claim, { force: true }); // no `.steal.*` debris on any path
  }
}

// Bounds the one unbounded shape: steal succeeds, a third party wins the `wx`, repeat.
const MAX_ATTEMPTS = 100;

/**
 * Acquire the lock at `<dir>/node_modules/.cache/<name>`; null if not taken within `waitMs`.
 *
 * `staleMs` is REQUIRED with no default — the invariant is per call site,
 * `staleMs > that site's harness timeout > its stage budget`, and a 90s value at a 600s site would
 * declare a healthy run stale. `name` is explicit because the edit pipeline already holds a lock at
 * the repo root whenever a root-level file is edited.
 */
export function acquireLock(dir, { name = 'claude-hook.lock', waitMs = 2000, staleMs } = {}) {
  if (typeof staleMs !== 'number' || !Number.isFinite(staleMs)) {
    throw new TypeError('acquireLock: staleMs is required — see the per-call-site invariant.');
  }

  const effectiveWaitMs = envInt('CLAUDE_HOOK_LOCK_WAIT_MS', waitMs);
  const effectiveStaleMs = envInt('CLAUDE_HOOK_LOCK_STALE_MS', staleMs);
  const lockPath = join(dir, 'node_modules', '.cache', name);

  // Before the first open, because `.cache` does not exist at the repo root and `wx` would throw
  // ENOENT rather than EEXIST. ENOENT on acquire is a BUG, never a retry condition.
  mkdirSync(dirname(lockPath), { recursive: true });

  const deadline = Date.now() + effectiveWaitMs;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const nonce = randomUUID();
    let fd;

    try {
      // Create-or-fail, atomic at the syscall level. This, not the record contents, picks the winner.
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      // A steal winner comes back through this same `wx` rather than renaming its way in: a third
      // process may have acquired cleanly in the gap, and rename-then-write would clobber it.
      if (trySteal(lockPath, effectiveStaleMs)) continue;
      // Only consulted when steal declines, so `waitMs: 0` means "wait for nobody", not "try once".
      // MAX_ATTEMPTS bounds the case where stealable records keep appearing.
      if (Date.now() >= deadline) return null;
      sleepSync(50);
      continue;
    }

    try {
      // The NONCE is the identity, not the pid: a recycled pid would make a dead holder look alive.
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now(), nonce }));
    } finally {
      closeSync(fd);
    }

    return { lockPath, nonce };
  }

  return null;
}

// Call immediately after acquire, BEFORE the first stage: a stealer can move a live record off the
// path, a third process win `wx` against the empty path, and the stealer restore the original over
// it — leaving that third process holding a lock whose record is gone. Closes that window; only
// narrows the general one, being an instant read before a multi-second spawn.
export function holdsLock(handle) {
  if (!handle) return false;
  return readRecord(handle.lockPath)?.nonce === handle.nonce;
}

// Only if the record is still ours, so a process that already lost the lock cannot delete the
// current holder's record on its way out.
export function releaseLock(handle) {
  if (!holdsLock(handle)) return;
  rmSync(handle.lockPath, { force: true });
}
