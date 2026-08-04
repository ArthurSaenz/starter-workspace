# .claude/hooks

The one place to look. Every hook, what it refuses, and which way it fails.

Pinned by `__tests__/hook-map.test.mjs`: if a file here is undocumented, or a doc claims a disarmed
rule is enforced, the suite fails. Run it with `pnpm run test:claude` — deliberately **not** part of
`pnpm qa` (see CLAUDE.md), so nothing else will run it for you.

## The map

| Event | Registered command | Role | Verdicts | Fails |
|---|---|---|---|---|
| `PreToolUse` / `Bash` | `bash-launcher.mjs` → `block-deploy.mjs` | deploy guard | deny via JSON | **closed** |
| `PreToolUse` / `Bash` | `bash-guard.mjs` | advisory guards | block (exit 2) / advise | **open** |
| `PreToolUse` / `Edit\|Write` | `protect-files.mjs` | protected paths | block (exit 2) | closed |
| `PostToolUse` / `Edit\|Write` | `edit-pipeline.mjs` | format + typecheck + lint feedback | context | open |
| `TaskCompleted` | `quality-gate.mjs` | runs `pnpm run qa` | block (exit 2) | closed |
| `SessionStart` | `setup-env.mjs` | env bootstrap | context | open |

Libraries, imported rather than registered: `hooklib.mjs` (event parsing, allow/block/context,
segment splitting), `lock.mjs` (cross-hook mutex), `lint-report.mjs` (lint output shaping).

## Why the Bash lane is two processes

This is the question people arrive with, so it is answered here rather than in a commit message.
The two entries are **not** duplication — they differ in three ways, each one tested:

| | deploy lane | advisory lane |
|---|---|---|
| Failure direction | closed — bad input or any error denies | open — a broken guard is skipped |
| Block channel | `permissionDecision: deny` JSON, exit 0 (holds under `bypassPermissions`) | stderr + exit 2 |
| False positives | **correct** — over-blocking a deploy costs nothing | **defects** — blocking `rg deliver src/` is a bug |

They cannot share a process. A syntax error is a module-link error: the file's body never runs, so
no `try/catch` and no declared fail direction is reachable, and Node exits 1 — which does **not**
block. Merged, a typo in a `grep` tip would silently disarm the prod deploy guard.

`bash-launcher.mjs` exists because that same mechanism applies to `block-deploy.mjs` itself. It is
~40 lines importing only Node builtins; it spawns the guard and turns any exit outside {0, 2} into a
deny, so a broken guard is a loud refusal instead of a silent pass. **Never add a relative import to
it** — that reopens the hole it closes, and the test suite enforces the rule.

The advisory lane is deliberately *not* wrapped: it is fail-open by design, and letting a `grep` tip
deny every Bash command is how guards get resented and deleted.

## Deploy rules — `block-deploy.mjs`

The switch is `const BLOCK` near the top of that file. Flip a line to open a rule. Delivery has no
line, so no line opens prod.

| Rule | State | What it refuses |
|---|---|---|
| `ghApiDispatch` | on | `gh api` against `/dispatches` (it POSTs implicitly on `-f`/`-F`) |
| `httpDispatch` | on | `curl` / `wget` / any assembled URL hitting `/dispatches` |
| `ghRunRerun` | on | re-running a past run — the run being repeated may have been a deploy |
| `ghWorkflowRun` | **off — `false`, not currently refused** | raw workflow dispatch. Disarmed so the non-deploy workflows stay dispatchable; prefer the infra-kit command regardless |

Delivery (`ik release deliver`, `dx-release-deliver`, and every spelling) is refused unconditionally,
with no switch: it merges the release PR into `main` with `--admin` and deploys prod.

**Allowed and expected:** deploying to non-prod through infra-kit — `mcp__infra-kit__gh-release-deploy-all`
/ `-selected`, or the CLI equivalents. infra-kit refuses prod itself. All reads are allowed:
`gh run list` / `view` / `watch`, `gh workflow view`, `gh api` GETs.

`.claude/settings.json` also carries `permissions.deny` entries for delivery and `doppler secrets`.
They are **defence in depth, not duplication**: a `deny` rule survives the hook file being deleted,
which is the one gap the hook cannot cover. Where the two disagree on wrapped or prefixed forms, the
hook is the more precise layer.

## Advisory rules — `bash-guard.mjs`

All six live in that one file as named exports, dispatched in this order (`doppler` first: when a
command trips two guards, the one about secrets is worth showing).

| Guard | Verdict | What it catches |
|---|---|---|
| `doppler` | block | `doppler secrets …` — prints secret values into a permanent transcript |
| `destructive` | block | `rm -rf`, bare `git push --force`, SQL `drop`/`truncate` |
| `package-manager` | block | `npm` / `yarn` / `npx` in a pnpm workspace |
| `style` | advise | prefer `rg` over `grep`, over `find -name` |
| `cmux` | block | `pnpm dev` outside a cmux session |
| `worktree` | block / advise | raw `git worktree add\|remove`; advises on `list` |

A guard may declare `scope = 'segment'` to be run per shell segment, so its `^`-anchored regex still
matches in `cd apps/client && npm install`. `style` and `cmux` deliberately read the whole line —
segmenting would strip the pipe that makes `grep foo | wc -l` acceptable, and the `cmux` that
authorises a wrapped `pnpm dev`.

The dispatcher sits behind `if (import.meta.main)`, so the unit tests import the guards directly
without the file reading stdin.

## Tests

| File | Covers |
|---|---|
| `block-deploy.test.mjs` | the deploy lane's corpus — named command tables plus `reason` assertions |
| `bash-guard.test.mjs` | each advisory guard as a unit, plus dispatcher integration |
| `bash-guard-corpus.test.mjs` | frozen snapshot of advisory verdicts; catches a rule lost in a move |
| `hook-map.test.mjs` | this README, settings paths, the launcher's zero-import rule, lane isolation |
| `guard-policy.test.mjs` | the over-blocking policy (I1/I2) as an executable invariant |
| `edit-hooks.test.mjs`, `lint-feedback.test.mjs`, `hook-lock.test.mjs`, `quality-gate.test.mjs`, `process-containment.test.mjs` | the Edit/Write and TaskCompleted lanes |

## Known limits

1. **A determined agent is not bound.** `eval`, base64 → `sh`, write-a-script-then-run-it. This layer
   shapes the well-meaning agent; the real control is server-side.
2. **`protect-files.mjs` cannot protect these hooks.** It matches `Edit|Write` and reads
   `tool_input.file_path`, which Bash events do not have — so `sed -i` is invisible to it.
3. **A parse error in `bash-launcher.mjs` itself fails open**, with nothing left to catch it. That is
   why it is small, builtins-only, and changes essentially never.
4. **`hooklib.mjs` is a shared load-time failure domain.** Four hooks import it, three of which
   block; a parse error there takes all four down at once, silently. The launcher does not cover
   this. Tracked as follow-up work.
