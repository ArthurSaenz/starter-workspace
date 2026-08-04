# [DO] Agent Deploy Guard

Agents may deploy to non-prod through infra-kit. They may not reach the workflow-dispatch endpoint
directly, and they may not deliver to prod.

**The mechanism lives in [`.claude/hooks/README.md`](../.claude/hooks/README.md)** — which hooks
exist, what each refuses, which way each fails, and where the rule switches are. That file is pinned
by `__tests__/hook-map.test.mjs`, so it cannot drift from the code. This document covers only what
that one does not: *why* the policy is shaped this way, and what is still missing.

## Why blanket, not per-workflow

- **Raw workflow dispatch.** Every legitimate dispatch has an infra-kit command, so a raw one only
  ever means "going around the rules". Blanket beats per-workflow: the CLI accepts a *name or
  numeric ID*, so a numeric dispatch would slip past any filename rule.
  *Current state: this rule is switched off (`ghWorkflowRun: false`) — see the README's rule table
  for what that means in practice.*
- **Re-running a past run** replays it with its **original inputs**, `environment=prod` included.
  The same deployment, one indirection away.
- **`/dispatches` via `gh api` or `curl`.** The dispatch CLI is sugar over this endpoint; blocking
  one without the other is a one-line bypass. Matched **regardless of HTTP method** — `gh api`
  silently POSTs as soon as `-f` is present, with no `-X`.
- **Delivery, all spellings, both naming eras.** It merges the release PR into `main` with `--admin`
  and deploys `prod`. Irreversible, and a human's call.

Deliberately allowed: `release-deploy-all` / `release-deploy-selected`, the sanctioned path —
infra-kit refuses `prod` itself (`assertDeployable` / `PROTECTED_ENVS` in
`lib/workflow-envs/protected-envs.ts`), so there is nothing for us to re-litigate. All reads are
allowed.

### Accepted cost

With the blanket rule armed, the agent cannot dispatch the non-deploy workflows either
(`code-quality.yml`, `e2e-playwright.yml`, `e2e-backoffice-real-smoke.yml`). A `deny` cannot be
carved out — in Claude Code deny always beats allow regardless of specificity, so "block dispatch
except e2e" is not expressible. Those workflows still run in CI automatically, and a human can
dispatch them. This cost is why the rule currently sits switched off; if it is re-armed, the fix for
the friction is an infra-kit command, not a hole in the guard.

## Known limits — read before trusting this

1. **This is a tripwire, not a wall.** The real control is server-side (below). The client-side
   layer shapes the *well-meaning* agent.
2. **A determined agent is not bound.** `eval`, base64 → `sh`, write-a-script-then-run-it — no
   string matcher catches those.
3. **`protect-files.mjs` cannot protect the guard.** It matches `Edit|Write` and reads
   `tool_input.file_path`, which Bash events do not have — so `sed -i` / `cat >` are invisible to it.
4. **A deleted hook file is not caught by the hook.** `permissions.deny` in `.claude/settings.json`
   survives that, which is why those entries are kept as defence in depth rather than removed.
5. **A hook that cannot parse used to fail open.** A syntax error is a module-link error: the file's
   body never runs, so no `try/catch` is reachable, and Node exits 1 — which does not block. This is
   now closed for the deploy lane by `bash-launcher.mjs`, which converts any exit outside {0, 2}
   into a deny. It remains open for every hook importing `hooklib.mjs` (see follow-up 2).

## Follow-up 1: the server-side control (not done)

The only thing that makes "cannot" literally true. Needs repo-admin on travelist / hulyo / nomadream.

1. **No job declares `environment:`.** In `_deploy-serverless-jobs.yml` the `environment:` at the top
   is a `workflow_call` *input*; the `service:` job has only `name`/`runs-on`/`env`. GitHub's
   Environment protection rules gate **only** jobs that declare the key — so today, configuring
   required reviewers would gate **zero jobs**. Add to the three reusable job files in each repo
   (`service`, `media`, `apply-infrastructure`):
   ```yaml
   environment: ${{ inputs.environment }}
   ```
   These files are **not** white-label-synced — three manual edits.
2. Create the Environments (lists differ per repo — read them from each `deploy-all.yml`).
3. Required reviewers on **`stage` + `prod` only**. Gating `dev`/personal envs would put a human
   click in front of every routine deploy, and the guard would get resented and removed.
4. **Enable "Prevent self-review."** Without it, step 3 is decorative: the agent dispatches with
   *your* token, and you are the reviewer — so it can approve its own deployment via the
   pending-deployments endpoint.
5. `CODEOWNERS` on `/.claude/` + `/.github/workflows/` with branch protection on `main` — the real
   anti-tamper control, and the one thing that makes limits (1) and (4) above survivable.

## Follow-up 2: `hooklib.mjs` is a shared failure domain (not done)

Four hooks import it statically, three of which block (`protect-files.mjs`, `quality-gate.mjs`,
`edit-pipeline.mjs`). By the mechanism in limit 5, a parse error in those 84 lines takes all four
down at once, silently, across two hook events. Sharpest instance: `quality-gate.mjs` says "failing
closed", yet its ability to fail closed is itself hostage to that import. Same bug class the
launcher closes for the deploy lane, one layer up.

## Verify after `pnpm white-label-sync`

Settings are read at **session start** — test in a fresh session or you will get a false green.
`pnpm run test:claude` covers the logic; this table covers the *registration*, which no test can
see (`helpers.runHook` invokes hooks by path, never through `settings.json`).

| Test | Expect |
|---|---|
| `gh api repos/o/r/actions/workflows/deploy-all.yml/dispatches -f ref=dev` (no `-X`) | blocked |
| `curl -X POST https://api.github.com/…/dispatches` | blocked |
| `pnpm dx-release-deliver` | blocked |
| `pnpm exec infra-kit release-deploy-all` | **allowed** |
| `gh run list` / `gh run view` / `gh api -X GET .../runs` | **allowed** |
| `rg -n "release-deliver" package.json` | **allowed** (no substring false positive) |
| `npm install` | blocked (advisory lane) |
| `grep foo file` | **allowed**, with a ripgrep tip attached |
