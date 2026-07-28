#!/usr/bin/env node
// Blocks agent-initiated deployments; reading workflow state stays allowed. A tripwire, not a wall
// — the real control is server-side. Self-contained and run as `node <path>`, so no sibling-hook bug
// or stripped exec bit turns a block into a silent pass. Denies via permissionDecision JSON, which
// holds under bypassPermissions where a settings deny rule would not.
//
// Known gaps: `bash script.sh`, `env -i gh workflow run x`, a quoted argv[0], `$(which gh)`,
// encodings, aliases, and URLs assembled without a literal `/dispatches`.

import { readFileSync } from 'node:fs';

// Any HTTP method, because `gh api` POSTs implicitly on -f/-F. The boundary class carries quotes
// and shell operators so an assembled URL still matches; the leading `/` keeps `ls dispatches/` out.
const RE_DISPATCH = /\/dispatches([/?"';&|]|\s|$)/i;
const RE_GITHUB_API = /api\.github\.com/i;
const RE_ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Anchored to one token, so `deploy-all` and `scripts/deliver` do not match.
const RE_DELIVER = /^(dx-)?(release-)?deliver$/i;

// A shell name ANYWHERE in a segment: every value-taking prefix (`nice -n 10`, `env -i`) leaves its
// own value at argv[0], and no membership list fixes that arity problem.
const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);

// Stripped from the head so the real command reaches argv[0]. Value-taking members are included
// even though stripping leaves their value behind — the wrapper gate covers that.
const PREFIX_COMMANDS = new Set([
  'sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'eval', 'nohup', 'nice', 'stdbuf', 'time', 'xargs',
]);

// Used ONLY when a shell wrapper is present — see checkRawShell.
const RE_RAW_WF_RUN = /\bgh\s+workflow\s+run\b/i;
const RE_RAW_RERUN = /\bgh\s+run\s+rerun\b/i;
const RE_RAW_GH_API = /\bgh\s+api\b/i; // MUST be ANDed with RE_DISPATCH — `gh api` alone is a read.

// "deliver" is ordinary product vocabulary ("feat: deliver emails"), so a bare one counts only
// alongside an infra-kit-ish tool in the same segment.
const RE_RAW_DELIVER_PREFIXED = /(?<![\w/-])(dx-|release-)(release-)?deliver(?![\w/-])/i;
const RE_BARE_DELIVER = /(?<![\w/-])deliver(?![\w/-])/i;
const RE_INFRA_TOOL = /\b(ik|infra-kit|pnpm|npm|npx|pnpx|yarn|node)\b/i;

// Not shared with checkInfraKit's RE_DELIVER: there argv[0] is already an infra tool, so this
// stricter form would fail open on `ik release deliver`.
const RE_DELIVER_HEAD = /^(dx-|release-)(release-)?deliver$/i;

// exit 0, because the JSON channel is only read on exit 0. `reason` is surfaced to the model.
function denyDecision(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function failClosed(reason) {
  denyDecision(`block-deploy: ${reason} — failing closed.`);
}

function deny(reason) {
  denyDecision(
    [
      `BLOCKED by deploy guard: ${reason}`,
      '',
      'Deploying to a non-prod environment IS allowed — but it goes through infra-kit,',
      'which enforces the deploy rules. Use the MCP tool:',
      '    mcp__infra-kit__gh-release-deploy-all         # dev / stage / personal envs',
      '    mcp__infra-kit__gh-release-deploy-selected    # a subset of services',
      'or the CLI:',
      '    pnpm exec infra-kit release-deploy-all',
      '    pnpm exec infra-kit release-deploy-selected',
      '',
      "prod is DELIVERED, never deployed ad-hoc — and delivery is a human's call:",
      '    pnpm dx-release-deliver                       # run by a human, not by you',
      '',
      'Reading workflow state is allowed: gh run list / view / watch, gh workflow view.',
    ].join('\n'),
  );
}

// Two-char operators before their single-char prefixes.
function splitIntoSegments(text) {
  return text
    .replaceAll('&&', '\n')
    .replaceAll('||', '\n')
    .replaceAll(';', '\n')
    .replaceAll('|', '\n')
    .replaceAll('&', '\n')
    .split('\n');
}

// Hand-rolled to keep this file dependency-free. Quotes go first, so `bash"` and `bash` reach the
// same verdict; stripping can only arm the gate more often, which is the fail-closed direction.
function basename(token) {
  const unquoted = token.replace(/^["']+|["']+$/g, '');
  return unquoted.slice(unquoted.lastIndexOf('/') + 1).toLowerCase();
}

// Without this, argv[0] is "GH_TOKEN=x" or "env" and every check misses. `stripped` lets an
// all-prefix segment fail closed; assignments do not set it, since `FOO=bar && pnpm test` is benign.
function tokenise(segment) {
  const raw = segment.trim().split(/\s+/).filter(Boolean);
  const argv = [];
  let stripping = true;
  let stripped = false;

  for (const token of raw) {
    if (stripping) {
      if (PREFIX_COMMANDS.has(basename(token))) {
        stripped = true;
        continue;
      }
      if (RE_ENV_ASSIGN.test(token)) continue;
      stripping = false;
    }
    argv.push(token);
  }

  return { argv, stripped };
}

// Positional, never substring: `gh run rerun` re-runs a deploy, `gh run list` reads.
function checkGh(argv, segment) {
  const verb = (argv[1] ?? '').toLowerCase();
  const object = (argv[2] ?? '').toLowerCase();

  if (verb === 'workflow' && object === 'run') {
    deny('`gh workflow run` bypasses infra-kit and dispatches a workflow directly.');
  }
  if (verb === 'run' && object === 'rerun') {
    deny('`gh run rerun` re-executes a previous run, deploy runs included.');
  }
  if (verb === 'api' && RE_DISPATCH.test(segment)) {
    deny('`gh api` against the workflow-dispatch endpoint (it POSTs implicitly on -f/-F).');
  }
}

// The same endpoint with no `gh` in sight.
function checkHttp(segment) {
  if (RE_GITHUB_API.test(segment) && RE_DISPATCH.test(segment)) {
    deny('direct HTTP call to the workflow-dispatch endpoint (bypasses every gh rule).');
  }
}

function checkInfraKit(argv) {
  for (const token of argv.slice(1)) {
    if (RE_DELIVER.test(token)) {
      deny(
        `\`${token}\` merges the release PR into main and deploys prod — irreversible, and a human's call.`,
      );
    }
  }
}

// argv positions are meaningless once a wrapper is present, and recursing into the `-c` payload
// fails OPEN because splitIntoSegments is quote-blind. Matching the ORIGINAL string over-blocks
// instead: a false deny announces itself, a false allow is silent.
function checkRawShell(command) {
  if (RE_RAW_WF_RUN.test(command)) {
    deny('`gh workflow run` inside a shell wrapper — dispatches a workflow directly, bypassing infra-kit.');
  }
  if (RE_RAW_RERUN.test(command)) {
    deny('`gh run rerun` inside a shell wrapper — re-executes a previous run, deploy runs included.');
  }
  // ANDed, else `gh api repos/o/r` would deny. Subsumed by the command-wide check below; it survives
  // only to name the rule the model sees.
  if (RE_RAW_GH_API.test(command) && RE_DISPATCH.test(command)) {
    deny('`gh api` against the workflow-dispatch endpoint inside a shell wrapper.');
  }
  if (RE_RAW_DELIVER_PREFIXED.test(command) || hasBareDeliverWithTool(command)) {
    deny(
      "a `deliver` command inside a shell wrapper — delivery merges the release PR into main and deploys prod, a human's call.",
    );
  }
  // Catches an endpoint assembled across segments, which checkHttp never sees whole.
  if (RE_DISPATCH.test(command)) {
    deny('the workflow-dispatch endpoint appears inside a shell wrapper — this hook is the only guard on that endpoint.');
  }
}

// Segment-scoped: command-wide would match `rg deliver . && pnpm build`.
function hasBareDeliverWithTool(command) {
  return splitIntoSegments(command).some(
    (segment) => RE_BARE_DELIVER.test(segment) && RE_INFRA_TOOL.test(segment),
  );
}

// An uncaught error exits non-zero-but-not-2, which does NOT block.
try {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    failClosed('unparseable hook input');
  }

  const toolName = input.tool_name ?? '';
  if (!toolName) failClosed('missing tool_name');
  if (toolName !== 'Bash') process.exit(0);

  const command = input.tool_input?.command ?? '';
  if (!command) process.exit(0);

  for (const segment of splitIntoSegments(command)) {
    if (!segment.trim()) continue;

    const { argv, stripped } = tokenise(segment);

    // Prefixes all the way down (`env`, `time`) — we cannot say what would have run, so we do not
    // guess. Accepted cost: `env | grep DOPPLER` denies.
    if (argv.length === 0) {
      if (stripped) failClosed('command consumed entirely by prefix stripping');
      continue;
    }

    const head = basename(argv[0]);

    // Every segment, not just curl/wget heads: it needs no argv, so gating on a head only loses
    // coverage. Before the wrapper arm, to catch a wrapped curl whose URL survived the split.
    checkHttp(segment);

    if (RE_DELIVER_HEAD.test(head)) {
      deny(
        `\`${argv[0]}\` is infra-kit's delivery entrypoint — it merges the release PR into main and deploys prod. Irreversible, and a human's call.`,
      );
    }

    // Cannot be a switch case — a switch cannot dispatch on Set membership. The `continue` skips
    // the positional gh checks, which is the quoted-argv[0] gap listed at the top.
    if (argv.some((token) => SHELL_WRAPPERS.has(basename(token)))) {
      checkRawShell(command);
      continue;
    }

    switch (head) {
      case 'gh':
        checkGh(argv, segment);
        break;
      // curl / wget need no case — checkHttp runs on every segment above.
      case 'pnpm':
      case 'npm':
      case 'npx':
      case 'pnpx':
      case 'yarn':
      case 'node':
      case 'infra-kit':
      case 'ik':
        checkInfraKit(argv);
        break;
    }
  }

  process.exit(0);
} catch (err) {
  failClosed(`internal error: ${err?.message ?? err}`);
}
