// Drift detector for full-cycle/SKILL.md's inline Planner->Architect->Critic consensus loop,
// which deliberately duplicates two clauses from OMC's own `plan` skill instead of delegating to
// it. If upstream changes or drops those clauses, this must fail loudly so the copy gets
// re-checked -- not rot silently. See .claude/skills/full-cycle/OMC_VERSION for the pinned version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PLUGINS_DIR = join(homedir(), '.claude', 'plugins');

// Recursive on purpose: the real install lives two levels below a decoy. `plugins/oh-my-claudecode/`
// exists and is empty -- the actual skill is under `plugins/cache/omc/oh-my-claudecode/<version>/`.
// A glob rooted one level too shallow would find nothing and silently look like "not installed".
const PLAN_SKILL_PATTERN = join(PLUGINS_DIR, '**', 'oh-my-claudecode', '*', 'skills', 'plan', 'SKILL.md');

const PINNED_VERSION = readFileSync(join(import.meta.dirname, '..', 'OMC_VERSION'), 'utf8').trim();

const matches = globSync(PLAN_SKILL_PATTERN);

if (matches.length === 0) {
  test('upstream OMC plan skill contract', (t) => {
    t.skip('OMC is a user-scope plugin, not present in this environment -- nothing to check');
  });
} else {
  // More than one match means the version actually in effect is ambiguous, so don't guess.
  assert.equal(
    matches.length,
    1,
    `expected exactly one OMC plan skill under ${PLUGINS_DIR}, found ${matches.length}: ` +
      `${matches.join(', ')} -- refusing to pick one; re-run with a clean plugin install`,
  );

  const [planSkillPath] = matches;
  const upstream = readFileSync(planSkillPath, 'utf8');
  const resolvedVersion = planSkillPath.match(/oh-my-claudecode[/\\]([^/\\]+)[/\\]skills[/\\]plan[/\\]SKILL\.md$/)?.[1];

  // Deliberately not a skip: a version mismatch is exactly the moment drift could have happened,
  // so it must fail rather than go quiet.
  test('resolved OMC version matches the full-cycle/OMC_VERSION pin', () => {
    assert.equal(
      resolvedVersion,
      PINNED_VERSION,
      `installed OMC plan skill is version ${resolvedVersion} but .claude/skills/full-cycle/OMC_VERSION ` +
        `pins ${PINNED_VERSION} -- bump the pin and re-check the copied consensus-loop clauses in ` +
        '.claude/skills/full-cycle/SKILL.md against the new upstream skills/plan/SKILL.md',
    );
  });

  test('upstream still forbids running Architect and Critic review in parallel', () => {
    // Robust to rewording (case, phrasing) but not to the rule vanishing: requires a negation
    // near "parallel", not an exact sentence match that a typo fix would break.
    assert.match(
      upstream,
      /\b(?:not|never)\b[^.\n]{0,100}\bparallel\b/i,
      'the sequential-not-parallel rule seems to have been removed from ' +
        `${planSkillPath} -- .claude/skills/full-cycle/SKILL.md copied this rule and must be ` +
        're-checked against upstream',
    );
  });

  test('upstream still bounds the consensus re-review loop at 5 iterations', () => {
    assert.match(
      upstream,
      /max(?:imum)?\s*(?:of\s*)?\s*5\s*iterations/i,
      'the max-5-iterations bound on the re-review loop seems to have been removed from ' +
        `${planSkillPath} -- .claude/skills/full-cycle/SKILL.md copied this bound and must be ` +
        're-checked against upstream',
    );
  });
}
