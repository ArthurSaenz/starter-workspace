#!/usr/bin/env node
// Blocks agent-initiated deployments; reading workflow state stays allowed. A tripwire, not a wall
// — the real control is server-side. Self-contained and run as `node <path>`, so no sibling-hook bug
// or stripped exec bit turns a block into a silent pass. Denies via permissionDecision JSON, which
// holds under bypassPermissions where a settings deny rule would not.
//
// Known gaps: `bash script.sh`, `env -i gh workflow run x`, a quoted argv[0], `$(which gh)`,
// encodings, aliases, and URLs assembled without a literal `/dispatches`. Also: a value-taking
// prefix whose option arity PREFIX_SPECS models wrongly — that residue lands at argv[0], where the
// leftover-value rescan re-anchors on a guarded tool or fails closed, so it over-blocks rather than
// passing. An unlisted prefix command is a real gap: it is not stripped, and its own name at argv[0]
// matches no case.

import { readFileSync } from 'node:fs';

// Any HTTP method, because `gh api` POSTs implicitly on -f/-F. The boundary class carries quotes
// and shell operators so an assembled URL still matches; the leading `/` keeps `ls dispatches/` out.
const RE_DISPATCH = /\/dispatches([/?"';&|]|\s|$)/i;
const RE_GITHUB_API = /api\.github\.com/i;
const RE_ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// A shell name ANYWHERE in a segment: every value-taking prefix (`nice -n 10`, `env -i`) leaves its
// own value at argv[0], and no membership list fixes that arity problem.
const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);

// Stripped from the head so the real command reaches argv[0].
const PREFIX_COMMANDS = new Set([
  'sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'eval', 'nohup', 'nice', 'stdbuf', 'time', 'xargs',
  // `time` was here and `timeout` was not, which is the whole of the bypass: the prefix survived to
  // argv[0], the head switch had no case for it, and with no wrapper token present nothing re-armed
  // the raw scan.
  'timeout', 'setsid', 'flock', 'script', 'watch',
]);

// What each prefix consumes before the real command. Bare arity is NOT enough — option flags leave
// their own residue: `script -q /dev/null gh …` puts `-q` at argv[0], as do `nice -n 10`,
// `timeout -k 5 60` and `flock -n`. Prefixes absent from this table are merely dropped; anything
// the table models wrongly falls through to the leftover-value rescan below rather than passing.
// Membership here also decides whether the leftover-value rescan may fire: only a prefix that
// actually consumes something can leave residue at argv[0]. `command -v pnpm` must not trigger it —
// there `-v` is the real command's own flag, and rescanning would deny an ordinary lookup.
const PREFIX_SPECS = {
  sudo: { valueOpts: ['-u', '--user', '-g', '--group', '-p', '--prompt'], values: 0 },
  timeout: { valueOpts: ['-k', '--kill-after', '-s', '--signal'], values: 1 },
  nice: { valueOpts: ['-n', '--adjustment'], values: 0 },
  flock: { valueOpts: ['-w', '--timeout', '-E', '--conflict-exit-code'], values: 1 },
  script: { valueOpts: ['-c', '--command'], values: 1 },
  watch: { valueOpts: ['-n', '--interval'], values: 0 },
  xargs: { valueOpts: ['-n', '-P', '-I'], values: 0 },
  stdbuf: { valueOpts: ['-i', '-o', '-e'], values: 0 },
  env: { valueOpts: ['-u', '--unset'], values: 0 },
};

// Cannot be a command name: an option, or a bare number/duration a value-taking prefix left behind.
const RE_LEFTOVER_VALUE = /^-|^\d+(\.\d+)?[smhd]?$/;

// Keyed on the TOOL, never on "any unrecognised head": `git`, `rg` and `echo` are all unrecognised,
// and basename() strips quotes, so a head-based rule would deny
// `git commit -m "…gh workflow run…"` — the commit that lands this very fix.
const GUARDED_TOOLS = new Set(['gh', 'ik', 'infra-kit']);

// Used ONLY when a shell wrapper is present — see checkRawShell.
const RE_RAW_WF_RUN = /\bgh\s+workflow\s+run\b/i;
const RE_RAW_RERUN = /\bgh\s+run\s+rerun\b/i;
const RE_RAW_GH_API = /\bgh\s+api\b/i; // MUST be ANDed with RE_DISPATCH — `gh api` alone is a read.

// "deliver" is ordinary product vocabulary ("feat: deliver emails"), so a bare one counts only
// alongside an infra-kit-ish tool in the same segment.
const RE_RAW_DELIVER_PREFIXED = /(?<![\w/-])(dx-|release-)(release-)?deliver(?![\w/-])/i;
const RE_BARE_DELIVER = /(?<![\w/-])deliver(?![\w/-])/i;
const RE_INFRA_TOOL = /\b(ik|infra-kit|pnpm|npm|npx|pnpx|yarn|node)\b/i;

// SELF-IDENTIFYING names only — the `dx-`/`release-` prefix is mandatory, so a bare `deliver`
// never matches. Used for argv[0] and, inside checkInfraKit, as one of that function's two routes.
// It cannot be the ONLY route there: `ik release deliver` carries its meaning in the sequence, not
// in a prefixed name, so this form alone would fail open on the most ordinary way to deliver.
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
  let i = 0;
  let stripped = false;
  let consumedValues = false;

  while (i < raw.length) {
    if (RE_ENV_ASSIGN.test(raw[i])) {
      i += 1;
      continue;
    }

    const name = basename(raw[i]);
    if (!PREFIX_COMMANDS.has(name)) break;

    stripped = true;
    i += 1;

    const spec = PREFIX_SPECS[name];
    if (!spec) continue;
    consumedValues = true;

    // Option flags first — a flag's value is skipped only when the flag is known to take a
    // detached one. `-I{}` and `-oL` carry theirs attached, so they consume nothing extra.
    while (i < raw.length && raw[i].startsWith('-')) {
      const takesValue = spec.valueOpts.includes(raw[i]);
      i += 1;
      if (takesValue && i < raw.length) i += 1;
    }

    for (let consumed = 0; consumed < spec.values && i < raw.length; consumed += 1) i += 1;
  }

  const argv = raw.slice(i);

  // argv[0] is still one of the prefix's own values, so the table did not fully model it. Guessing
  // would fail open; instead re-anchor on a guarded tool further along, and if there is none let
  // the caller fail closed on the empty argv.
  if (consumedValues && argv.length > 0 && RE_LEFTOVER_VALUE.test(argv[0])) {
    const at = argv.findIndex((token) => GUARDED_TOOLS.has(basename(token)));
    return { argv: at === -1 ? [] : argv.slice(at), stripped };
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

// A bare `deliver` is ordinary product vocabulary — `pnpm exec rg deliver src/` is a search, and
// scanning every token for it is what made this guard deny ordinary work. So it takes a
// conjunction, by either of two routes. BOTH are required: the prefixed form alone fails open on
// `ik release deliver` (see RE_DELIVER_HEAD's note), and the positional form alone misses
// `pnpm dx-release-deliver`, whose name carries the whole meaning.
function checkInfraKit(argv) {
  const rest = argv.slice(1);

  const prefixed = rest.find((token) => RE_DELIVER_HEAD.test(basename(token)));
  if (prefixed) {
    deny(
      `\`${prefixed}\` merges the release PR into main and deploys prod — irreversible, and a human's call.`,
    );
  }

  // The SEQUENCE, not two loose tokens: `rg release src/ && rg deliver src/` must stay a search.
  const at = rest.findIndex((token) => basename(token) === 'release');
  if (at !== -1 && rest[at + 1] !== undefined && basename(rest[at + 1]) === 'deliver') {
    deny(
      "`release deliver` merges the release PR into main and deploys prod — irreversible, and a human's call.",
    );
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

  // UNCONDITIONALLY, before the segment loop. This is the last-resort check on the one endpoint
  // this hook calls its reason to exist, and it used to sit inside checkRawShell — so it ran only
  // when a shell wrapper happened to be present. `A=https://api.github.com ; curl $A/…/dispatches`
  // splits host and path into different segments, so the per-segment call below never sees both.
  //
  // Still the host AND path conjunction, never a bare `/dispatches`: the token appears throughout
  // this repo's own tests and docs, and denying it alone would block `rg "/dispatches" .claude/` —
  // the search anyone working on this guard runs. See guard-policy.test.mjs for that measurement.
  checkHttp(command);

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
