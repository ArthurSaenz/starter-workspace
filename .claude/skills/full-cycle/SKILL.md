---
name: full-cycle
description: Run the OMC lifecycle as one pipeline - confirm scope, deep-interview crystallizes requirements, an inline Planner/Architect/Critic consensus loop produces the plan, a plan-review gate, a human approval stop, then ralph implements; verify runs on re-entry because ralph exits the run. Stops for you five times, six if consensus does not converge, and expects you present throughout. Requires oh-my-claudecode. Use for multi-file work with real unknowns; not for small changes.
argument-hint: "[--from=interview|plan|plan-review|implement|verify] [--slug=<slug>] [--dry-run] [--deliberate] <idea or task description>"
aliases: [fullcycle]
pipeline: [full-cycle, deep-interview, ralph, verify]
next-skill: deep-interview
next-skill-args: --standard
handoff: .omc/specs/full-cycle-{slug}.md
handoff-policy: approval-required
---

# Full Cycle

## What This Skill Does

Sequences the whole OMC lifecycle behind one command, and owns the sequence so that a review gate can
sit between the plan being produced and a human committing to it.

    scope -> interview -> plan -> plan-review -> approval -> implement -> verify -> done

Two things here are not conveniences. The **plan-review** stage exists because a commented review of
a plan needs somewhere to live, and that place only exists inside something that owns the ordering.
And **resume is the normal completion path**, not an interruption handler — `implement` ends the run,
so `verify` is always reached by invoking this skill again.

## Do Not Use When

- **The task is small.** Below roughly three files, or with no genuine unknown, this is far more
  ceremony than the work. Delegate to an `executor` agent, or use `/oh-my-claudecode:ralph` directly.
- **You want a fire-and-forget pipeline.** This stops for you **five times** (six when consensus does
  not converge, seven if an artifact binding needs confirming) and expects you present throughout.
- **You expect it to finish in one go.** It cannot. `implement` exits the run; you re-invoke to reach
  verification.
- **You want cheap iterations.** The quality-gate hook runs full-monorepo `pnpm qa` on every task
  completion, and ralph completes a task per iteration, so a long run pays for `qa` many times over.
- **oh-my-claudecode is not installed.** Every delegated stage resolves an OMC skill or agent, so the
  skill is non-functional without it — while Claude Code will still load and offer it. Check first.

## Execution Steps

Preconditions are evaluated on **every** entry path, including every `--from`:

1. The branch is not `main`. If it is, stop and ask.
2. OMC resolves: `deep-interview`, `ralph` and `verify` exist as skills.

Then compute the stage rather than assuming it:

```
node .claude/skills/full-cycle/scripts/resume.mjs [--slug=<slug>]
```

### S0 · scope — STOP 1

Write `.omc/specs/full-cycle-{slug}.md` (SPEC0) and stop for scope approval. SPEC0 carries run
identity only — `slug`, `branch`, `scope_approved_at`, `interview_spec_path`, `implement_launched_at`,
`review_rounds`, `status`. It never carries the stage; the stage is computed from artifacts every time.

The scope statement must restate the task in your own words and name: the branch, the stage list, the
expected number of consensus and ralph iterations, that **each ralph iteration triggers a
full-monorepo `qa`**, how many stops remain, and that **the run ends at `implement` and must be
re-invoked to verify**. Disclose the cost before the user agrees to pay it.

On approval, record `scope_approved_at`. Invoking with `--from` **is** scope approval.

### S1 · interview — STOPS 2 and 3

`Skill("oh-my-claudecode:deep-interview")` with `--standard`. It runs a multi-turn Socratic loop
(stop 2) and then stops on its own approval gate (stop 3). Record the spec path it returns into
`interview_spec_path`.

deep-interview's body will show `Pipeline: deep-interview -> plan`. **That hop is superseded** —
planning happens at S2 here, with an inline consensus loop, and the `plan` skill is not invoked.

If `interview_spec_path` was never recorded, do **not** re-run the interview blindly and do **not**
glob for a spec: the interview derives its own slug from the idea and accepts no slug argument, and a
repo accumulates specs. Look for a candidate — including any `spec_path` deep-interview persisted in
state — and **ask the user to confirm the binding**. Only re-run the interview when there is no
candidate at all.

### S2 · plan

Run the consensus loop inline. Do not invoke the `plan` skill: it stops rather than returning, which
would end the run before the gate at S3 exists.

- `Task(oh-my-claudecode:planner)` writes and revises `.omc/plans/full-cycle-{slug}.plan.md`. The
  Planner is the **only** author of that file — `architect` and `critic` are read-only agents.
- **MUST be sequential, never parallel: await the Architect's result before issuing the Critic.**
  This overrides the default policy of firing independent agent calls simultaneously. Run in parallel
  and the Critic reviews a plan the Architect has not yet improved, which is a silent quality loss,
  not an error anyone will see.
- One iteration is: collect Architect and Critic feedback -> Planner revises -> back to Architect ->
  back to Critic. **Maximum 5.** At 5, present the best version and note that consensus was not
  reached — that is a stop, and it is the sixth interaction point.
- Merge accepted improvements into the plan file, with a changelog of what was applied.
- The plan carries principles, decision drivers, at least two options with invalidation rationale,
  and an ADR. With `--deliberate`, add a three-scenario pre-mortem and a unit/integration/e2e/
  observability test plan. **Short mode is the default** — deliberate doubles the cost of the most
  expensive stage.

The three agents are advisory. None may edit source, commit, push, or invoke an execution skill.

If the Planner wrote to a path of its own choosing rather than the canonical one, **rename it to the
canonical path** after confirming with the user. The canonical path is what the resume procedure
checks; a second location silently forks the run.

### S3 · plan-review

```
node .claude/skills/full-cycle/scripts/plan-review-gate.mjs --plan=<plan path>
```

Today this is a documented no-op that writes `skipped`. It is a real executing stage so that a future
commented-review implementation is a one-file swap. See the contract below.

On `changes-requested`, return to S2 with the review's `comments[]` as input. Revising the plan
changes its bytes, which invalidates the review, so the next entry lands back here rather than
looping — that is what makes the cycle terminate.

Terminable is not the same as bounded. `review_rounds` counts revisions, and at **5** the run stops
and asks you to intervene rather than going round again: a reviewer that never relents is not
something the digest can fix.

### S4 · approval — STOP 4

The one boundary that is prose-enforced, and the expensive one.

> Execution approval must be an explicit user message in the **current turn**. A summarized,
> compacted, or recalled approval from an earlier turn is not approval; if it is not present verbatim
> in the live context, re-ask. It is never written to any file.

### S5 · implement — TERMINAL

Record `implement_launched_at` **before** launching, then `Skill("oh-my-claudecode:ralph")`.

Instruct ralph to scope its per-iteration checks to the affected packages and leave full `qa` to S6.

**This ends the run.** ralph's success path finishes by cancelling, so do not plan work after it in
the same invocation. Verification is a separate entry.

### S6 · verify — re-entry only

`Skill("oh-my-claudecode:verify")` plus a fresh `verifier` agent in a separate lane, so the work is
not reviewed by whoever did it. Run `pnpm qa`, and `pnpm test:claude` if anything under `.claude/**`
changed. Paste actual command output as evidence; never a summary of it.

### S7 · done

Set SPEC0 `status: done`.

## The resume decision procedure

`resume.mjs` implements this. **Ordered, first match wins, and the order is load-bearing** — the
guards are not disjoint, so they must not be permuted or rewritten as a switch.

```
P0  precondition failure, malformed SPEC0, or a CURRENT review whose
    status is outside the four-value enum                        -> exit 1
P1  SPEC0 present AND status == done                             -> done
P2  SPEC0 absent OR scope_approved_at absent                     -> scope
P3  interview_spec_path absent, or the file it names is missing  -> interview
P4  the canonical plan file is absent                            -> plan
P5  no CURRENT review, OR its status is pending                  -> plan-review
P6  CURRENT review status is changes-requested                   -> plan
P7  implement_launched_at present                                -> verify
P8  otherwise (review approved or skipped, not yet launched)     -> approval
```

A review is **CURRENT** only when its `plan_digest` matches the plan on disk right now. A revised plan
leaves its review stale, and a stale review is treated exactly as absent.

`--from` selects where evaluation begins, never which gates apply. It constitutes **scope approval
only**: `--from=implement` still stops at S4 and asks for execution approval in the current turn.
`resume.mjs` does not parse `--from` — honouring it is your job, and honouring it means writing
`scope_approved_at` and then entering the named stage, not skipping the gates after it.

`resume.mjs` enforces two preconditions itself: it refuses `main`, and it refuses a run whose SPEC0
`branch` differs from HEAD, because those artifacts describe work that is not in this tree. Outside a
git repo neither applies. **Checking that OMC resolves is your job, not the script's** — a script that
hard-failed without OMC would fail in CI, where OMC is legitimately absent.

If the worktree is removed mid-run, the artifacts under `.omc/` go with it and the run restarts at
S1. For a long run inside a worktree, set `OMC_STATE_DIR` first.

## Plan-review gate contract

A future commented-review implementation must satisfy all six:

1. **The review file is authoritative.** Its `status` is the verdict; the exit code merely mirrors it
   for synchronous runs and is never consulted when the file is present and well-formed.
2. `status` is one of `approved`, `changes-requested`, `pending`, `skipped`. **`pending` is in the
   enum today** because commented human review is intrinsically long-lived: an implementation may
   record `pending`, return immediately, and be completed by a person minutes or days later.
3. Synchronous exit codes: `0` approved/skipped, `3` changes-requested, `4` pending, `1` internal
   error. The `--plan` argument is stable; flags may be added, never removed or repurposed.
4. `comments[]` entries are `{anchor, body, severity}`, where `anchor` is a line range or heading in
   the plan file.
5. **Idempotent per (plan path, `plan_digest`)** — re-running against an unchanged plan is a no-op and
   never overwrites `approved` or `changes-requested`, but a revised plan gets a fresh review.
6. Interactive or browser front ends live behind an explicit flag, so `--dry-run` and CI stay headless.

`plan_digest` is mandatory. Without it the revise-and-review cycle cannot terminate.

Both the plan and its review live under `.omc/`, which is gitignored — so neither is visible in a pull
request. Reaching a second reviewer means copying to a tracked path or publishing.

## Rules

- **Never enter `implement` without execution approval.** Execution approval must be an explicit user
  message in the **current turn**. A summarized, compacted, or recalled approval from an earlier turn
  is not approval; if it is not present verbatim in the live context, re-ask. It is never written to
  any file.
- **This skill writes no OMC mode state, and receives none.** `full-cycle` is not a registered
  `state_write` mode, it is not a canonical workflow skill, and skill protection resolves to `none`
  for any skill whose raw name lacks the `oh-my-claudecode:` prefix — so no `skill-active` state is
  ever written for it. Delegated skills manage their own state; do not manage it for them. The
  consequence is real: **S2 has no stop-hook continuation protection.** An ordinary stop ends the
  consensus loop, and recovery is re-invocation via P4.
- **`implement` is the last stage of a run.** ralph's success path ends by cancelling, which clears
  state and opens a brief window in which stop-hook enforcement is disabled for all modes. Do not
  plan work after ralph in the same invocation.
- **No stage triggers deploys or releases.** `.claude/hooks/block-deploy.mjs` is the sole source of
  truth for what is refused; do not restate its list here or anywhere else.
- **Never glob for a delegate's artifact.** Record the path the delegate returns. When it is missing,
  ask the user to confirm the binding.
- Run the tests with `pnpm run test:claude` after changing anything in this directory.

## Contract drift

This skill depends on OMC internals that its own documentation does not describe. Pinned version is
in `OMC_VERSION`; `__tests__/frontmatter.test.mjs` and `__tests__/upstream-contract.test.mjs` fail
loudly when the pin or the copied clauses move.

- **Pipeline frontmatter renders on one route only.** `renderSkillPipelineGuidance` has two call
  sites: one bounded to OMC's own bundled skills directory, and one in the auto-slash-command hook.
  For a project skill, the `pipeline` / `next-skill` / `handoff` / `handoff-policy` keys therefore
  render **only** when a user types `/full-cycle` with OMC's hook active. Via Claude Code's native
  Skill tool, model-initiated invocation, or with `DISABLE_OMC` / `OMC_SKIP_HOOKS` set, they are
  inert. **The body above is primary on every route; the frontmatter only confirms it.**
- **OMC renders its own approval sentence** on that hook route — "explicit approval in the current
  turn or structured approval UI" — which has no compaction clause and is outside this skill's
  control. It lands at the scope boundary, not the execution boundary. The body's sentence is
  stricter and governs.
- **`pipeline` is display-only.** It is joined into a header and never resolved against a registry.
  Only `next-skill` becomes a real call.
- **The frontmatter parser is a line-scanner.** Block-form YAML lists parse to empty, so `aliases` and
  `pipeline` must stay inline. A folded `description: >-` parses to the literal `>-`, so the
  description must remain one physical line.
- **None of the integration tests run in CI.** OMC is a user-scope plugin, never a repo dependency, so
  the drift detectors are local pre-commit signals only. CI covers the two scripts' unit tests.
