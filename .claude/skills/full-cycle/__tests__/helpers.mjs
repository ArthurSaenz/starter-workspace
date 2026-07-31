// Shared test helpers for the full-cycle skill. Scripts are spawned as real subprocesses so the
// suite asserts on real exit codes and stdout, same as .claude/hooks/__tests__/helpers.mjs.
//
// THE FORWARD-RUN BUILDER IS THE POINT. Tests must never hand-write a SPEC0 file. A hand-built
// state can describe a stage combination no real run produces, and a fixture like that makes a dead
// predicate look reachable — which is exactly how an earlier draft shipped a resume procedure whose
// only reachable output was `scope` while eight fixtures passed. Every mutator below is one stage
// effect, applied in the order the stages actually run, so a fixture is a prefix of a real run.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SCRIPTS_DIR = join(import.meta.dirname, '..', 'scripts');

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function runScript(name, args = [], { cwd, env = {} } = {}) {
  const r = spawnSync('node', [join(SCRIPTS_DIR, name), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

export const runResume = (run, args = []) => runScript('resume.mjs', args, { cwd: run.dir });

// A disposable repo root. Everything a test writes stays under os.tmpdir().
export function scratchDir() {
  return mkdtempSync(join(tmpdir(), 'full-cycle-'));
}

const write = (path, body) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
};

const stamp = (n) => `2026-07-31T0${n}:00:00.000Z`;

// SPEC0 is markdown with a frontmatter block; resume.mjs parses only the fields it needs.
function renderSpec0(fields) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n# full-cycle run ${fields.slug}\n`;
}

class Run {
  constructor(dir, slug) {
    // A cold-start fixture writes nothing, so the root has to exist before a script is spawned in it.
    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.slug = slug;
    this.fields = null;
    this.spec0Path = join(dir, '.omc', 'specs', `full-cycle-${slug}.md`);
    this.planPath = join(dir, '.omc', 'plans', `full-cycle-${slug}.plan.md`);
    this.reviewPath = `${this.planPath}.review.json`;
    this.interviewPath = join(dir, '.omc', 'specs', `deep-interview-${slug}-idea.md`);
  }

  #flush() {
    write(this.spec0Path, renderSpec0(this.fields));
    return this;
  }

  // S0 writes SPEC0 and stops for scope approval.
  scope() {
    this.fields = { slug: this.slug, branch: 'do/full-cycle', status: 'pending approval', review_rounds: 0 };
    return this.#flush();
  }

  // S0's stop is answered: scope approval recorded.
  approveScope() {
    this.fields.scope_approved_at = stamp(1);
    return this.#flush();
  }

  // S1 returns; the interview's own spec path is recorded, never globbed for.
  interview() {
    write(this.interviewPath, '# interview spec\n\nCrystallized requirements.\n');
    this.fields.interview_spec_path = this.interviewPath;
    return this.#flush();
  }

  // S2's consensus loop writes the plan at the canonical slug-bound path.
  plan(body = '# plan v1\n\nOriginal plan body.\n') {
    write(this.planPath, body);
    return this;
  }

  // S2 again, after changes-requested. New bytes mean a new digest, which staleness-invalidates
  // any existing review — the property that lets the revise/review cycle terminate.
  revisePlan(body = '# plan v2\n\nRevised in response to review comments.\n') {
    write(this.planPath, body);
    this.fields.review_rounds = (this.fields.review_rounds ?? 0) + 1;
    return this.#flush();
  }

  // S3's gate writes a review bound to the plan bytes it reviewed.
  review(status = 'skipped', { digest } = {}) {
    const plan = readFileSync(this.planPath);
    write(
      this.reviewPath,
      `${JSON.stringify({
        stage: 'plan-review',
        status,
        plan: this.planPath,
        plan_digest: digest ?? sha256(plan),
        comments: status === 'changes-requested' ? [{ anchor: '# plan v1', body: 'tighten scope', severity: 'major' }] : [],
      })}\n`,
    );
    return this;
  }

  // A review left behind by a previous plan revision. Explicitly not a hand-built state: it is what
  // review() produces once revisePlan() has moved the plan on underneath it.
  staleReview(status = 'approved') {
    return this.review(status, { digest: sha256('bytes from a plan that no longer exists') });
  }

  // S4's execution approval is conversational and is never written. S5 records only that it
  // launched, before launching, because S5 is terminal and cannot write anything afterwards.
  launchImplement() {
    this.fields.implement_launched_at = stamp(2);
    return this.#flush();
  }

  // S6 verified and S7 closed the run out.
  finish() {
    this.fields.status = 'done';
    return this.#flush();
  }
}

export function newRun(slug = 'demo', dir = scratchDir()) {
  return new Run(dir, slug);
}

// P0's branch checks only engage inside a git repo, so a fixture that exercises them needs one.
export function initGit(dir, branch = 'do/full-cycle') {
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('checkout', '-q', '-b', branch);
  writeFileSync(join(dir, '.keep'), '');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}
