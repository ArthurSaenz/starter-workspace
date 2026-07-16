# [DO] Agent Deploy Guard

Agents may deploy to non-prod through infra-kit. They may not reach the workflow-dispatch
endpoint directly, and they may not deliver to prod.

## Shipped (client-side, this repo → synced to the fleet)

| File | Role |
|---|---|
| `.claude/settings.json` | `permissions.deny` + registers the hook. Deny beats allow and is unioned across settings files, so the broad `Bash(pnpm:*)` in `settings.local.json` cannot re-open it. |
| `.claude/hooks/block-deploy.sh` | Positional argv parser. Catches what a prefix rule cannot see: `/dispatches` via `gh api` / `curl`, and the deny'd commands when an env prefix or `sudo` shifts `argv[0]`. |
| `CLAUDE.md` | The soft rule + the human handoff protocol. |

### Blocked
- `gh workflow run` — **wholesale**. Every legitimate dispatch has an infra-kit command, so a
  raw one only ever means "going around the rules". Blanket beats per-workflow: `gh workflow run`
  accepts a *name or numeric ID*, so `gh workflow run 12345678` would slip past any filename rule.
- `gh run rerun` — re-executing a past deploy run replays it with its **original inputs**,
  `environment=prod` included. The same deployment, one indirection away.
- `gh api` / `curl` against `/dispatches` — `gh workflow run` is sugar over this endpoint.
  Blocking one without the other is a one-line bypass. Matched **regardless of HTTP method**:
  `gh api` silently POSTs as soon as `-f` is present, with no `-X`.
- `release-deliver` (all invocation forms, both naming eras) — it merges the release PR into
  `main` with `--admin` and deploys `prod`. Irreversible.

### Deliberately allowed
- `release-deploy-all` / `release-deploy-selected` — the sanctioned deploy path. infra-kit already
  refuses `prod` itself (`assertDeployable` / `PROTECTED_ENVS`, `lib/workflow-envs/protected-envs.ts`),
  so there is nothing for us to re-litigate here.
- All reads: `gh run list|view|watch`, `gh workflow list|view`, `gh api` GETs.

### Accepted cost
The agent can no longer dispatch the non-deploy workflows either (`code-quality.yml`,
`e2e-playwright.yml`, `e2e-backoffice-real-smoke.yml`). A `deny` cannot be carved out — in Claude
Code deny always beats allow, regardless of specificity, so "block `gh workflow run` except e2e"
is not expressible. Those workflows still run in CI automatically, and a human can dispatch them.
If this bites, the fix is an infra-kit command, not a hole in the guard.

## Known limits — read before trusting this

1. **The hook fails OPEN.** Only exit 2 blocks; a deleted script exits 127, which does not block —
   and `Bash(rm:*)` is in the allow list. `permissions.deny` survives that; the hook does not.
2. **A determined agent is not bound.** `eval`, base64 → `sh`, write-a-script-then-run-it — no
   string matcher catches those. This layer shapes the *well-meaning* agent.
3. **`protect-files.sh` cannot protect this guard.** It matches `Edit|Write` and reads
   `tool_input.file_path`, which does not exist for Bash — so `sed -i` / `cat >` are invisible to it.
4. **The hook is untested by design** — the deny rules are the primary layer and are declarative
   (they cannot break silently), so a test suite for the secondary layer was judged not worth its
   weight. Consequence: if the hook's patterns stop matching, nothing says so. The known trigger is
   the in-flight infra-kit rename (`do/cli-drop-flat-aliases`: `release-deliver` → `release deliver`).
   `is_deliver_token()` already covers both spellings — keep it that way when the branch lands.

## Follow-up: the server-side control (not done)

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
   *your* token, and you are the reviewer — so it can approve its own deployment via
   `gh api -X POST .../pending_deployments -f state=approved`.
5. `CODEOWNERS` on `/.claude/` + `/.github/workflows/` with branch protection on `main` — the real
   anti-tamper control, and the one thing that makes limit (1) and (3) above survivable.

## Verify after `pnpm white-label-sync`

Settings are read at **session start** — test in a fresh session or you will get a false green.

| Test | Expect |
|---|---|
| `gh workflow run deploy-all.yml -f environment=dev` | blocked |
| `gh api repos/o/r/actions/workflows/deploy-all.yml/dispatches -f ref=dev` (no `-X`) | blocked |
| `pnpm dx-release-deliver` | blocked |
| `pnpm exec infra-kit release-deploy-all` | **allowed** |
| `gh run list` / `gh run view` / `gh api -X GET .../runs` | **allowed** |
| `grep -n "release-deliver" package.json` | **allowed** (no substring false positive) |
