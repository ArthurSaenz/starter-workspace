// The over-blocking policy, made executable. Two guards in this repo hold OPPOSITE positions on
// false blocks — `block-deploy` argues a false deny announces itself while a false allow is silent,
// and `cmux` treats a false deny as a defect. Both are defensible; holding both without a stated
// boundary is what produced a guard that denied `pnpm exec rg deliver src/`.
//
// I1 — for an irreversible-action guard, a false block on a read-only command is acceptable when
//      the matched string has essentially one purpose, and unacceptable when it is ordinary
//      vocabulary. This file decides which is which by measurement rather than by opinion.
//
// I2 — a guard's last-resort catch-all must not be nested inside a conditional arm. If a check is
//      described as "the only guard on X", it must run unconditionally. Asserted behaviourally in
//      block-deploy.test.mjs, by the no-shell-wrapper dispatch case: the catch-all lived inside
//      `checkRawShell` and so only ran when a wrapper happened to be present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { HOOKS_DIR } from './helpers.mjs';

const REPO_ROOT = resolve(HOOKS_DIR, '..', '..');

// SELF-REFERENCE IS NOT VOCABULARY. The guard's own source, its tests, and documents *about* the
// guard all name the strings it matches — counting those would make every guarded pattern look
// like ordinary language and the rule would never discriminate. Mechanical, because "documents
// about the guard" is not something a test can infer.
// Deliberately NOT `:!*.md`: a guarded token sitting in an ordinary README is exactly the evidence
// this rule wants to see. Measured — both verdicts below hold with general markdown left in.
const EXCLUDED = [':!.claude/hooks', ':!.omc', ':!docs', ':!CLAUDE.md'];

// Tracked files only, so an untracked scratch file cannot flip the verdict.
function ordinarySourceMatches(pattern) {
  const result = spawnSync(
    'git',
    ['grep', '--no-color', '-I', '-n', '-F', '-e', pattern, '--', '.', ...EXCLUDED],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  // git grep exits 1 for "no matches", which is the answer here, not a failure.
  if (result.status === 1) return [];
  assert.equal(result.status, 0, `git grep failed for ${pattern}: ${result.stderr}`);

  return (result.stdout ?? '').split('\n').filter(Boolean);
}

// One purpose: assembling this path has exactly one outcome, so denying a read-only command that
// happens to contain it costs nothing anybody wanted.
test('I1: the dispatch endpoint is not ordinary vocabulary — over-blocking on it is allowed', () => {
  const matches = ordinarySourceMatches('/dispatches');

  assert.deepEqual(
    matches,
    [],
    `\`/dispatches\` appears in ordinary source, so it is vocabulary and the guard must NOT ` +
      `match it unconditionally:\n${matches.join('\n')}`,
  );
});

// The counter-case, and the input that decides C3. This asserts the MEASUREMENT, not the fix: if
// `deliver` ever stops appearing in ordinary source the premise has changed and the conjunction
// requirement in checkInfraKit can be revisited. The fix itself is pinned by the C3 corpus in
// block-deploy.test.mjs.
test('I1: `deliver` IS ordinary vocabulary — so the bare token may not deny on its own', () => {
  const matches = ordinarySourceMatches('deliver');

  assert.ok(
    matches.length > 0,
    'premise of the C3 conjunction: `deliver` was measured as ordinary vocabulary in this repo. ' +
      'If this now finds nothing, re-derive the policy rather than loosening the guard.',
  );
});
