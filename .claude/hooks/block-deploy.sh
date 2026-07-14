#!/bin/bash
# Blocks agent-initiated deployments. Reading workflow state stays allowed.
#
# Deploys go through infra-kit, which owns the deploy rules (`assertDeployable`
# refuses `prod` — see infra-kit lib/workflow-envs/protected-envs.ts). This guard
# exists to stop the agent from going AROUND infra-kit and hitting the workflow
# dispatch endpoint directly, where those rules do not apply. GitHub happily
# accepts `-f environment=prod` from a release branch; the veto is ours, not its.
#
# Split of duties with permissions.deny in settings.json:
#   deny  -> `gh workflow run` and `release-deliver` (prefix match, cannot be deleted)
#   here  -> the same intent expressed as REST (`/dispatches`), which a prefix rule
#            cannot see, because the endpoint sits mid-argument. Also re-catches the
#            deny'd commands when an env prefix or `sudo` shifts argv[0].
#
# This hook fails OPEN if it is deleted (a missing script exits 127, which does not
# block). It is a tripwire, not a wall. The durable control is server-side.
set -uo pipefail

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || {
  echo "block-deploy: jq missing — failing closed." >&2
  exit 2
}

TOOL=$(jq -r '.tool_name // empty' <<<"$INPUT")
[ -n "$TOOL" ] || {
  echo "block-deploy: unparseable hook input — failing closed." >&2
  exit 2
}

[ "$TOOL" = "Bash" ] || exit 0

CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT")
[ -n "$CMD" ] || exit 0

deny() {
  {
    echo "BLOCKED by deploy guard: $1"
    echo
    echo "Agents do not launch deployments. Deploy to a non-prod environment goes"
    echo "through infra-kit, which enforces the deploy rules:"
    echo "    pnpm exec infra-kit release-deploy-all        # dev / stage / personal envs"
    echo "    pnpm exec infra-kit release-deploy-selected"
    echo
    echo "prod is DELIVERED, never deployed ad-hoc — and delivery is a human's call:"
    echo "    pnpm dx-release-deliver                       # run by a human"
    echo
    echo "Reading workflow state is allowed: gh run list / view / watch, gh workflow view."
  } >&2
  exit 2
}

# The workflow-dispatch REST endpoint. Matched regardless of HTTP method: `gh api`
# silently switches to POST as soon as -f/-F is present, with NO -X flag, so a check
# for "-X POST" would wave the most obvious bypass straight through:
#   gh api repos/O/R/actions/workflows/deploy-all.yml/dispatches -f ref=main
DISPATCH_PATH='/dispatches([/?[:space:]]|$)'

# infra-kit's prod-delivery command, in both naming eras: flat (`release-deliver`,
# what the consumer repos use today) and nested (`release deliver`, what the
# do/cli-drop-flat-aliases branch renames it to).
is_deliver_token() {
  case "$1" in
    release-deliver | deliver | dx-release-deliver) return 0 ;;
    *) return 1 ;;
  esac
}

# Split on && || ; | and newlines, then inspect each segment POSITIONALLY. Dispatching
# on argv[0] — never substring-matching the whole line — is what keeps read-only work
# alive: `grep -n "release-deliver" package.json` has argv[0]=grep and never enters the
# case at all. (The repo's older block-destructive.sh substring-matches, and blocks a
# read-only `grep` whose search string happens to contain a destructive command.)
while IFS= read -r seg; do
  # strip leading whitespace, `sudo`, and env-var prefixes (FOO=bar gh workflow run ...)
  seg=$(sed -E 's/^[[:space:]]*//; s/^(sudo[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*//' <<<"$seg")
  [ -n "$seg" ] || continue

  read -ra tok <<<"$seg"
  bin=${tok[0]:-}
  a1=${tok[1]:-}
  a2=${tok[2]:-}

  case "$bin" in
    gh)
      # `gh workflow run` blocks. `gh workflow list|view` does not.
      if [ "$a1" = workflow ] && [ "$a2" = run ]; then
        deny "\`gh workflow run\` bypasses infra-kit and dispatches a workflow directly."
      fi
      # `gh workflow run` is sugar over this endpoint. Blocking one without the other
      # leaves a one-line bypass.
      if [ "$a1" = api ] && grep -qEi "$DISPATCH_PATH" <<<"$seg"; then
        deny "\`gh api\` against the workflow-dispatch endpoint (it POSTs implicitly when -f/-F is present)."
      fi
      ;;

    curl | wget)
      if grep -qi 'api\.github\.com' <<<"$seg" && grep -qEi "$DISPATCH_PATH" <<<"$seg"; then
        deny "direct HTTP call to the workflow-dispatch endpoint (bypasses every gh rule)."
      fi
      ;;

    pnpm | npm | npx | pnpx | yarn | node | infra-kit | ik)
      for t in "${tok[@]:1}"; do
        if is_deliver_token "$t"; then
          deny "\`$t\` merges the release PR into main and deploys to prod — irreversible, and a human's call."
        fi
      done
      ;;
  esac
done < <(printf '%s\n' "$CMD" | sed -E 's/(\|\||&&|[;|&])/\n/g')

exit 0
