#!/usr/bin/env node
// Computes which full-cycle stage to enter, from artifacts on disk. Stage is never stored — SPEC0
// records run identity only, so there is no cached stage to invalidate.
//
// THE PREDICATE ORDER IS LOAD-BEARING. The guards are NOT disjoint: P3 and P4 both match "no
// interview and no plan"; P5 and P7 both match "review pending and already launched". First match
// wins, so reordering these or rewriting them as a switch changes behaviour silently. The order is
// the order the stages run, and every predicate is reachable from a state a forward run produces —
// see __tests__/resume.test.mjs, which builds each fixture by replaying stage effects.
//
// Never emits `implement`, and never reads or writes execution approval. Approval is conversational
// and lives in the turn, not on disk; a script consulting a persisted approval flag would just be
// the agent asking itself for permission.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REVIEW_STATUSES = ['approved', 'changes-requested', 'pending', 'skipped'];

// Matches the consensus loop's own bound. A reviewer that keeps asking for changes is not something
// the digest can fix — staleness makes the cycle terminable, not bounded.
const MAX_REVIEW_ROUNDS = 5;

const die = (code, reason) => {
  process.stderr.write(`resume: ${reason}\n`);
  process.exit(code);
};

const arg = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const root = arg('dir') ?? process.cwd();
const specsDir = join(root, '.omc', 'specs');
const plansDir = join(root, '.omc', 'plans');

// Only the fields the procedure branches on. A field nothing reads is a field that drifts.
function parseSpec0(path) {
  const text = readFileSync(path, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const fields = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// --slug wins. Otherwise: no candidates is a cold start, not an error; one is the run; more than
// one is genuinely ambiguous and we ask rather than guess, because a repo accumulates runs.
function resolveSlug() {
  const explicit = arg('slug');
  if (explicit) return explicit;
  if (!existsSync(specsDir)) return null;

  const candidates = [];
  for (const name of readdirSync(specsDir)) {
    const m = /^full-cycle-(.+)\.md$/.exec(name);
    if (!m) continue;
    const fields = parseSpec0(join(specsDir, name));
    if (fields === null) die(1, `malformed SPEC0: ${join(specsDir, name)}`);
    if (fields.status !== 'done') candidates.push(m[1]);
  }
  if (candidates.length > 1) {
    die(3, `ambiguous run: ${candidates.length} unfinished runs (${candidates.join(', ')}). Pass --slug=<slug>.`);
  }
  return candidates[0] ?? null;
}

// A review is CURRENT only if its digest matches the plan on disk right now. A revised plan leaves
// its review STALE, and every predicate treats a stale review as absent — which is what lets the
// changes-requested cycle terminate instead of routing back to `plan` forever.
function readReview(planPath) {
  const reviewPath = `${planPath}.review.json`;
  if (!existsSync(planPath) || !existsSync(reviewPath)) return null;

  let review;
  try {
    review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  } catch {
    die(1, `malformed review file: ${reviewPath}`);
  }
  const digest = createHash('sha256').update(readFileSync(planPath)).digest('hex');
  if (review.plan_digest !== digest) return null;

  // Enum validation applies to CURRENT reviews only: a stale file is already being discarded, so a
  // garbage status inside it is not worth failing the run over.
  if (!REVIEW_STATUSES.includes(review.status)) {
    die(1, `review status not in {${REVIEW_STATUSES.join(', ')}}: ${JSON.stringify(review.status)}`);
  }
  return review;
}

// P0's branch half. `main` is refused outright, and a run resumed on a branch it did not start on
// is refused too — its artifacts describe work that is not in this tree. Outside a git repo there is
// nothing to check, which is the normal case for the test fixtures.
function checkBranch(fields) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return;
  const branch = (r.stdout ?? '').trim();
  if (branch === 'main') die(1, 'refusing to run on main — switch to a working branch first');
  if (fields?.branch && fields.branch !== branch) {
    die(1, `run started on '${fields.branch}' but HEAD is '${branch}'. Switch back, or start a new run.`);
  }
}

function main() {
  const slug = resolveSlug();
  const spec0Path = slug === null ? null : join(specsDir, `full-cycle-${slug}.md`);
  const fields = spec0Path && existsSync(spec0Path) ? parseSpec0(spec0Path) : null;
  if (spec0Path && existsSync(spec0Path) && fields === null) die(1, `malformed SPEC0: ${spec0Path}`);

  checkBranch(fields);

  const planPath = slug === null ? null : join(plansDir, `full-cycle-${slug}.plan.md`);
  const review = planPath && existsSync(planPath) ? readReview(planPath) : null;

  // P1 — an explicitly named run that already finished.
  if (fields && fields.status === 'done') return 'done';

  // P2 — no run yet, or scope not yet approved. Cold start lands here.
  if (!fields || !fields.scope_approved_at) return 'scope';

  // P3 — the interview has not returned, or its recorded spec is gone.
  if (!fields.interview_spec_path || !existsSync(fields.interview_spec_path)) return 'interview';

  // P4 — no plan at the canonical slug-bound path.
  if (!existsSync(planPath)) return 'plan';

  // P5 — never reviewed, review went stale under a revised plan, or review is still open.
  if (!review || review.status === 'pending') return 'plan-review';

  // P6 — reviewer asked for changes on THIS plan; S2 revises, which staleness-invalidates the
  // review and routes the next entry back to P5 rather than looping here. The digest makes the
  // cycle terminable; this bound makes it terminate even against a reviewer that never relents.
  if (review.status === 'changes-requested') {
    const rounds = Number(fields.review_rounds ?? 0);
    if (Number.isFinite(rounds) && rounds >= MAX_REVIEW_ROUNDS) {
      die(1, `plan-review has requested changes ${rounds} times (max ${MAX_REVIEW_ROUNDS}). Stop and involve the user.`);
    }
    return 'plan';
  }

  // P7 — ralph was launched, so the run continues at verification. Before P8: on re-entry the
  // execution approval is by definition not in the current turn, and asking for it again would
  // re-approve work already done.
  if (fields.implement_launched_at) return 'verify';

  // P8 — reviewed and clean, awaiting execution approval in the current turn.
  return 'approval';
}

process.stdout.write(`${main()}\n`);
