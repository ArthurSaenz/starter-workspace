// Every fixture is built by replaying stage effects (helpers.mjs), never by hand-writing SPEC0.
// That is the whole discipline: a hand-built state can describe a stage combination no real run
// produces, and such a fixture makes a dead predicate look reachable.

import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { initGit, newRun, runResume, runScript, scratchDir, SCRIPTS_DIR } from './helpers.mjs';

const stage = (run, args) => {
  const r = runResume(run, args);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  return r.stdout;
};

// ---------------------------------------------------------------------------
// One fixture per predicate, each a prefix of a real forward run.
// ---------------------------------------------------------------------------

test('P2: a cold start with no run at all -> scope', () => {
  const run = newRun('cold');
  assert.equal(stage(run), 'scope');
});

test('P2: SPEC0 written but scope not yet approved -> scope', () => {
  const run = newRun('unapproved').scope();
  assert.equal(stage(run), 'scope');
});

test('P3: scope approved, interview has not returned -> interview', () => {
  const run = newRun('pre-interview').scope().approveScope();
  assert.equal(stage(run), 'interview');
});

test('P3: recorded interview spec has gone missing -> interview', () => {
  const run = newRun('lost-spec').scope().approveScope().interview();
  const gone = join(run.dir, '.omc', 'specs', 'gone.md');
  writeFileSync(run.spec0Path, readFileSync(run.spec0Path, 'utf8').replace(run.interviewPath, gone));
  assert.equal(stage(run), 'interview');
});

test('P4: interview returned, no plan yet -> plan', () => {
  const run = newRun('pre-plan').scope().approveScope().interview();
  assert.equal(stage(run), 'plan');
});

test('P5: plan written, never reviewed -> plan-review', () => {
  const run = newRun('pre-review').scope().approveScope().interview().plan();
  assert.equal(stage(run), 'plan-review');
});

test('P5: review still open (pending) -> plan-review', () => {
  const run = newRun('open-review').scope().approveScope().interview().plan().review('pending');
  assert.equal(stage(run), 'plan-review');
});

test('P6: changes-requested on THIS plan -> plan', () => {
  const run = newRun('rework').scope().approveScope().interview().plan().review('changes-requested');
  assert.equal(stage(run), 'plan');
});

test('P7: ralph was launched -> verify, not approval', () => {
  const run = newRun('launched').scope().approveScope().interview().plan().review('approved').launchImplement();
  assert.equal(
    stage(run),
    'verify',
    'P7 must precede P8: on re-entry the approval is not in the current turn, and asking again would re-approve work already done',
  );
});

test('P8: reviewed clean, not yet launched -> approval', () => {
  const run = newRun('awaiting').scope().approveScope().interview().plan().review('approved');
  assert.equal(stage(run), 'approval');
});

test('P8: a skipped review is as good as approved -> approval', () => {
  const run = newRun('skipped-review').scope().approveScope().interview().plan().review('skipped');
  assert.equal(stage(run), 'approval');
});

test('P1: an explicitly named finished run -> done', () => {
  const run = newRun('finished').scope().approveScope().interview().plan().review('approved').launchImplement().finish();
  assert.equal(stage(run, [`--slug=${run.slug}`]), 'done');
});

// ---------------------------------------------------------------------------
// Termination: the property the digest mechanism exists for.
// ---------------------------------------------------------------------------

test('the changes-requested cycle TERMINATES: revising the plan staleness-invalidates its review', () => {
  const run = newRun('cycle').scope().approveScope().interview().plan().review('changes-requested');
  assert.equal(stage(run), 'plan', 'first pass routes back to S2 to revise');

  run.revisePlan();
  assert.equal(
    stage(run),
    'plan-review',
    'after revision the stale review must NOT keep routing to plan — that was an infinite S2 -> P6 -> S2 loop',
  );

  run.review('approved');
  assert.equal(stage(run), 'approval', 'a fresh approving review lets the run advance');
});

test('a stale review is treated as absent even when it says approved', () => {
  const run = newRun('stale-approved').scope().approveScope().interview().plan().staleReview('approved');
  assert.equal(stage(run), 'plan-review');
});

test('a stale review carrying an out-of-enum status does NOT fail the run', () => {
  const run = newRun('stale-garbage').scope().approveScope().interview().plan().staleReview('bogus-status');
  assert.equal(
    stage(run),
    'plan-review',
    'staleness is checked before enum validation; the file is already being discarded',
  );
});

test('a CURRENT review with an out-of-enum status exits 1', () => {
  const run = newRun('bad-enum').scope().approveScope().interview().plan().review('bogus-status');
  const r = runResume(run);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not in \{/);
});

// ---------------------------------------------------------------------------
// Run identity, failure modes, order-dependence.
// ---------------------------------------------------------------------------

test('two runs with distinct slugs never observe each other', () => {
  const dir = scratchDir();
  const a = newRun('alpha', dir).scope().approveScope().interview().plan().review('approved');
  const b = newRun('beta', dir).scope().approveScope();

  assert.equal(stage(a, ['--slug=alpha']), 'approval');
  assert.equal(stage(b, ['--slug=beta']), 'interview');
});

test('two unfinished runs and no --slug is ambiguous -> exit 3, never a guess', () => {
  const dir = scratchDir();
  newRun('alpha', dir).scope().approveScope();
  newRun('beta', dir).scope().approveScope();

  const r = runScript('resume.mjs', [], { cwd: dir });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /ambiguous/);
});

test('a finished run does not make a second run ambiguous', () => {
  const dir = scratchDir();
  newRun('old', dir).scope().approveScope().interview().plan().review('approved').launchImplement().finish();
  const live = newRun('live', dir).scope().approveScope();
  assert.equal(stage(live), 'interview');
});

test('malformed SPEC0 exits 1 rather than guessing a stage', () => {
  const run = newRun('broken').scope();
  writeFileSync(run.spec0Path, 'no frontmatter here\n');
  const r = runResume(run, [`--slug=${run.slug}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /malformed SPEC0/);
});

test('malformed review file exits 1', () => {
  const run = newRun('bad-json').scope().approveScope().interview().plan().review('approved');
  writeFileSync(run.reviewPath, '{ not json');
  const r = runResume(run);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /malformed review/);
});

test('resume never emits implement, on any forward state', () => {
  const dir = scratchDir();
  const emitted = new Set();
  // Each prefix of the forward run, applied cumulatively — step i is stages 0..i, not stage i
  // alone. A single mutator on a fresh run is not a state any run reaches.
  const steps = [
    (r) => r.scope(),
    (r) => r.approveScope(),
    (r) => r.interview(),
    (r) => r.plan(),
    (r) => r.review('approved'),
    (r) => r.launchImplement(),
    (r) => r.finish(),
  ];
  for (let i = 0; i <= steps.length; i += 1) {
    const run = newRun(`walk-${i}`, join(dir, String(i)));
    steps.slice(0, i).forEach((step) => step(run));
    emitted.add(stage(run, [`--slug=walk-${i}`]));
  }
  assert.ok(!emitted.has('implement'), `resume emitted implement: ${[...emitted].join(', ')}`);
  assert.deepEqual(
    [...emitted].sort(),
    ['approval', 'done', 'interview', 'plan', 'plan-review', 'scope', 'verify'],
  );
});

test('the predicate order is load-bearing: permuting P3 and P4 changes the answer', () => {
  const src = readFileSync(join(SCRIPTS_DIR, 'resume.mjs'), 'utf8');
  const p3 =
    "  if (!fields.interview_spec_path || !existsSync(fields.interview_spec_path)) return 'interview';";
  const p4 = "  if (!existsSync(planPath)) return 'plan';";
  assert.ok(src.includes(p3) && src.includes(p4), 'predicate source moved — update this test with it');

  // A state where BOTH guards match: no interview and no plan. Order alone decides the answer.
  const run = newRun('order').scope().approveScope();
  assert.equal(stage(run), 'interview');

  const permutedDir = scratchDir();
  cpSync(SCRIPTS_DIR, permutedDir, { recursive: true });
  const permuted = src.replace(p3, '__SWAP__').replace(p4, p3).replace('__SWAP__', p4);
  assert.notEqual(permuted, src, 'the swap did not apply');
  writeFileSync(join(permutedDir, 'resume.mjs'), permuted);

  const r = spawnSync('node', [join(permutedDir, 'resume.mjs'), `--dir=${run.dir}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout.trim(),
    'plan',
    'permuting P3 and P4 must change the answer. If this reports "interview", the guards have become ' +
      'disjoint and the load-bearing-order comment in resume.mjs is no longer true.',
  );
});

test('the fixture builder is the sole writer of SPEC0 in this suite', () => {
  // The needle is assembled from parts so this guard does not match its own source.
  const needle = ['.omc', 'specs', 'full-cycle-'].join('/');
  const offenders = readdirSync(import.meta.dirname)
    .filter((f) => f.endsWith('.test.mjs'))
    .filter((f) => readFileSync(join(import.meta.dirname, f), 'utf8').includes(needle));
  assert.deepEqual(
    offenders,
    [],
    `these tests build SPEC0 paths directly instead of using helpers.mjs: ${offenders.join(', ')}. ` +
      'Hand-built states reach predicate combinations no forward run produces.',
  );
});

// ---------------------------------------------------------------------------
// P0 preconditions.
// ---------------------------------------------------------------------------

test('P0: refuses to run on main', () => {
  const run = newRun('on-main');
  initGit(run.dir, 'main');
  run.scope().approveScope();
  const r = runResume(run);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to run on main/);
});

test('P0: refuses a run resumed on a different branch than it started on', () => {
  const run = newRun('moved');
  initGit(run.dir, 'do/full-cycle');
  run.scope().approveScope();
  assert.equal(stage(run), 'interview', 'matching branch proceeds normally');

  spawnSync('git', ['checkout', '-q', '-b', 'do/somewhere-else'], { cwd: run.dir });
  const r = runResume(run);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /started on 'do\/full-cycle' but HEAD is 'do\/somewhere-else'/);
});

test('P0: outside a git repo there is nothing to check', () => {
  const run = newRun('no-git').scope().approveScope();
  assert.equal(stage(run), 'interview');
});

test('P6 is BOUNDED: a reviewer that never relents stops the run instead of looping', () => {
  const run = newRun('never-happy').scope().approveScope().interview().plan();
  for (let i = 0; i < 5; i += 1) {
    run.review('changes-requested');
    assert.equal(stage(run), 'plan', `round ${i + 1} routes back to revise`);
    run.revisePlan(`# plan rev ${i}\n`);
  }
  run.review('changes-requested');
  const r = runResume(run);
  assert.equal(r.status, 1, 'the sixth round must stop, not loop');
  assert.match(r.stderr, /requested changes 5 times \(max 5\)/);
});

// Scoped honestly: this proves the builder roots fixtures in tmpdir and that no full-cycle test
// names a repo path. It does not prove the whole .claude suite is hermetic — the hook suites, which
// now run under the same script, do write scratch material beneath the repo's own .omc.
test('every full-cycle fixture is rooted in os.tmpdir()', () => {
  for (const slug of ['a', 'b', 'c']) {
    assert.ok(newRun(slug).dir.startsWith(tmpdir()), `fixture escaped tmpdir for ${slug}`);
  }
});
