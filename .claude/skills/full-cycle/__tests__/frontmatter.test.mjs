// Drift detector for the OMC internals this skill depends on but its docs do not describe.
//
// FAILS rather than skips on anything that could be drift — a version off the pin, or two competing
// installs. Skips only when OMC is absent altogether: it is a user-scope plugin, never a repo
// dependency, so absence is the normal state in CI and is not evidence of anything.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const SKILL_DIR = join(import.meta.dirname, '..');
const SKILL_MD = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const PINNED = readFileSync(join(SKILL_DIR, 'OMC_VERSION'), 'utf8').trim();

const EXPECTED_KEYS = [
  'name',
  'description',
  'argument-hint',
  'aliases',
  'pipeline',
  'next-skill',
  'next-skill-args',
  'handoff',
  'handoff-policy',
];

// Replica of OMC's frontmatter parser: a naive line-scanner, not a YAML parser. Block-form lists
// collapse and folded scalars are stored literally, which is why this frontmatter is written the way
// it is. Reproduced here so assertions test what OMC will actually see.
function parseFrontmatterLikeOmc(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const metadata = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0 || /^[\s-]/.test(line)) continue;
    metadata[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return metadata;
}

function findAll(dir, rel, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    const candidate = join(child, rel);
    if (existsSync(candidate) && statSync(candidate).isFile()) out.push(candidate);
    out.push(...findAll(child, rel, depth + 1));
  }
  return out;
}

const PLUGIN_ROOT = join(homedir(), '.claude', 'plugins');
// Only version-bearing INSTALL paths are candidates: .../oh-my-claudecode/<version>/dist/...
// A marketplace source checkout (plugins/marketplaces/omc/dist/...) ships the same file with no
// version in its path, so it cannot answer "which version is installed" and is not what the pin is
// about. Two versioned installs remain genuine ambiguity and still fail below.
const VERSIONED_INSTALL = /\/oh-my-claudecode\/[^/]+\/dist\/utils\/skill-pipeline\.js$/;
const RENDERERS = findAll(PLUGIN_ROOT, join('dist', 'utils', 'skill-pipeline.js')).filter((p) =>
  VERSIONED_INSTALL.test(p),
);

// One resolution, one policy, applied identically everywhere: absent skips, ambiguous fails.
function requireRenderer(t) {
  if (RENDERERS.length === 0) {
    t.skip(`no oh-my-claudecode install under ${PLUGIN_ROOT} — expected in CI, where OMC is not a dependency`);
    return null;
  }
  assert.equal(
    RENDERERS.length,
    1,
    `expected one versioned OMC install, found ${RENDERERS.length}:\n${RENDERERS.join('\n')}\n` +
      'Ambiguous resolution means the version under test is unknown. Never skip past this.',
  );
  return RENDERERS[0];
}

const versionOf = (p) => p.split('/oh-my-claudecode/')[1]?.split('/')[0];

// The stage the body runs immediately after the S0 stop, read from the skill it invokes there.
function stageAfterScope(body) {
  const s1 = /^### S1 [^\n]*\n([\s\S]*?)(?=^### )/m.exec(body);
  assert.ok(s1, 'no "### S1" section found — the body structure moved');
  const invoked = /Skill\("oh-my-claudecode:([a-z-]+)"\)/.exec(s1[1]);
  assert.ok(invoked, 'the S1 section invokes no OMC skill');
  return invoked[1];
}

// THE agreement assertion. Both the live check and the falsification fixture call this exact
// function, so the fixture proves the real assertion can fail — not merely that two strings differ.
// It takes the rendered value rather than the renderer, so the falsification still runs without OMC.
function assertAgreement(renderedNextSkill, body) {
  assert.equal(
    renderedNextSkill,
    stageAfterScope(body),
    'the frontmatter and the body name different next stages. Two disagreeing instructions in one ' +
      'prompt is worse than one instruction alone — fix whichever is wrong.',
  );
}

test('exactly one versioned OMC install resolves, and it matches the pin', (t) => {
  const renderer = requireRenderer(t);
  if (!renderer) return;
  assert.equal(
    versionOf(renderer),
    PINNED,
    `OMC resolved to ${versionOf(renderer)} but OMC_VERSION pins ${PINNED}. This is drift, not a skip: ` +
      "re-validate SKILL.md's frontmatter behaviour and the clauses copied into S2, then move the pin.",
  );
});

test('renderSkillPipelineGuidance still takes (skillName, pipeline)', async (t) => {
  const renderer = requireRenderer(t);
  if (!renderer) return;
  const mod = await import(renderer);
  assert.equal(typeof mod.renderSkillPipelineGuidance, 'function');
  assert.equal(
    mod.renderSkillPipelineGuidance.length,
    2,
    'arity changed. A one-argument call returns "" silently, so this skill would lose its rendered ' +
      'guidance with no error surfacing.',
  );
});

test('the rendered "Next skill" names the same stage the body runs after S0', async (t) => {
  const renderer = requireRenderer(t);
  if (!renderer) return;
  const mod = await import(renderer);
  const fm = parseFrontmatterLikeOmc(SKILL_MD);

  const rendered = mod.renderSkillPipelineGuidance(fm.name, mod.parseSkillPipelineMetadata(fm));
  const next = /Next skill:\s*`([^`]+)`/.exec(rendered);
  assert.ok(next, `no "Next skill:" line in rendered guidance:\n${rendered}`);

  assertAgreement(next[1], SKILL_MD);
});

test('the agreement assertion can fail: a body whose S1 runs a different skill throws', () => {
  const mismatched = SKILL_MD.replace(
    'Skill("oh-my-claudecode:deep-interview")',
    'Skill("oh-my-claudecode:ralph")',
  );
  assert.notEqual(mismatched, SKILL_MD, 'fixture did not apply — the S1 invocation moved');

  // Same function the live check uses, with the value the real frontmatter renders.
  assert.doesNotThrow(() => assertAgreement('deep-interview', SKILL_MD));
  assert.throws(
    () => assertAgreement('deep-interview', mismatched),
    /different next stages/,
    'the agreement check cannot fail, so it proves nothing',
  );
});

test('frontmatter parses to exactly the approved key set under OMC rules', () => {
  const fm = parseFrontmatterLikeOmc(SKILL_MD);
  assert.deepEqual(Object.keys(fm).sort(), [...EXPECTED_KEYS].sort());
  assert.equal(fm.name, 'full-cycle', 'name must equal the directory name so both loaders resolve it alike');
});

test('description survives the line-scanner and is not a folded scalar', () => {
  const fm = parseFrontmatterLikeOmc(SKILL_MD);
  assert.ok(!['>-', '>', '|', '|-'].includes(fm.description), 'a folded description parses to the marker itself');
  assert.ok(fm.description.length > 80, 'description collapsed');
});

test('list fields survive OMC\'s parser in inline form', async (t) => {
  const renderer = requireRenderer(t);
  if (!renderer) return;
  const { parseSkillPipelineMetadata } = await import(renderer);
  const pipeline = parseSkillPipelineMetadata(parseFrontmatterLikeOmc(SKILL_MD));
  assert.ok(
    Array.isArray(pipeline.steps) && pipeline.steps.length > 0,
    'pipeline parsed to empty — block-form lists collapse, so inline form is required',
  );
});

test('every delegated skill still resolves in the installed OMC', (t) => {
  const renderer = requireRenderer(t);
  if (!renderer) return;
  const skillsDir = join(dirname(dirname(dirname(renderer))), 'skills');
  for (const name of ['deep-interview', 'ralph', 'verify']) {
    assert.ok(
      existsSync(join(skillsDir, name, 'SKILL.md')),
      `${name} no longer resolves under ${skillsDir}. This skill delegates to it by directory name.`,
    );
  }
});
