import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHook, bash } from './helpers.mjs';

const HOOK = 'block-deploy.mjs';

// Denies via permissionDecision JSON on stdout with exit 0, so assert on the JSON, not the code.
function decision(command, opts) {
  const res = runHook(HOOK, command === null ? '{bad json' : bash(command), opts);
  return { denied: /"permissionDecision"\s*:\s*"deny"/.test(res.stdout), status: res.status };
}

const HOST = 'https://api.github.com';
const PATH = 'repos/o/r/actions/workflows/w.yml/dispatches';

const BLOCKED = [
  ['gh workflow run', 'gh workflow run deploy.yml'],
  ['gh api dispatches (space boundary)', 'gh api repos/o/r/actions/workflows/w.yml/dispatches -f ref=main'],
  ['gh api dispatches (query boundary)', 'gh api repos/o/r/actions/workflows/w.yml/dispatches?ref=main'],
  ['gh run rerun', 'gh run rerun 123'],
  ['env-prefixed gh api', 'GH_TOKEN=x gh api repos/o/r/actions/workflows/w.yml/dispatches -f x=1'],
  ['sudo-prefixed', 'sudo gh workflow run x'],
  ['compound &&', 'echo hi && gh workflow run x'],
  ['compound ;', 'true; gh run rerun 5'],
  ['curl to dispatches', 'curl -X POST https://api.github.com/repos/o/r/actions/workflows/w.yml/dispatches'],
  ['wget to dispatches', 'wget https://api.github.com/repos/o/r/actions/workflows/w.yml/dispatches'],
  ['ik release deliver', 'pnpm exec ik release deliver'],
  ['pnpm dx-release-deliver', 'pnpm dx-release-deliver'],
  ['ik release-deliver token', 'ik release-deliver'],
  ['node ... deliver', 'node ./bin release deliver'],
  ['mixed case', 'GH WORKFLOW RUN x'],
  ['tab-separated', 'gh\tworkflow\trun x'],

  // RE_DISPATCH's boundary class carries quotes, so the closing `"` terminates the path.
  ['quoted URL', `gh api "${HOST}/${PATH}" -f x=1`],
  ['single-quoted URL', `gh api '${HOST}/${PATH}' -f x=1`],

  // --- shell wrappers: argv positions stop describing what runs, so phrases are matched raw ---
  ['bash -c gh workflow run', 'bash -c "gh workflow run deploy.yml"'],
  ['sh -c gh run rerun', "sh -c 'gh run rerun 123'"],
  ['zsh -c', 'zsh -c "gh workflow run x"'],
  ['/bin/bash -c', '/bin/bash -c "gh workflow run x"'],
  ['compound inside the payload', 'bash -c "gh workflow run x && pnpm build"'],
  ['nested wrapper with escaped quotes', 'bash -c "bash -c \\"gh workflow run x\\""'],
  // Caught by checkHttp on the segment, not by the wrapper machinery — the `assembly:` rows below
  // are the real wrapper-path test.
  ['wrapped curl to dispatches (caught segment-wise)', `bash -c "curl -X POST ${HOST}/${PATH}"`],
  ['wrapped curl, single-quoted URL (caught segment-wise)', `bash -c "curl '${HOST}/${PATH}'"`],
  ['wrapped gh api dispatches', `bash -c "gh api ${PATH} -f a=1"`],
  ['wrapped dx-release-deliver', 'bash -c "pnpm dx-release-deliver"'],
  ['wrapped ik release deliver', 'bash -c "ik release deliver"'],

  // The only rows that fail if basename() stops stripping quotes.
  ['quoted wrapper token', '"bash" -c "gh workflow run x"'],
  ['quoted prefix token', '"sudo" gh workflow run x'],

  // --- assembled endpoint: the split puts host and path in different segments ---
  ['assembly: host in a variable', `bash -c 'H=${HOST}; curl "$H/${PATH}"'`],
  ['assembly: host + prefix in a variable', `bash -c 'H=${HOST}/repos/o/r; curl "$H/actions/workflows/w.yml/dispatches"'`],
  ['assembly: path in a variable (pins `;` in the boundary class — allows without it)', `bash -c 'P=/${PATH}; curl "${HOST}$P"'`],

  // --- any-token gate: a value-taking prefix leaves its value at argv[0], disarming a head gate ---
  ['timeout + wrapper', 'timeout 60 bash -c "gh workflow run x"'],
  ['env -i + wrapper', 'env -i bash -c "gh workflow run x"'],
  ['nice -n + wrapper', 'nice -n 10 bash -c "gh workflow run x"'],
  ['stdbuf + wrapper', 'stdbuf -oL bash -c "gh workflow run x"'],
  ['xargs -I + wrapper', 'xargs -I{} bash -c "gh workflow run x"'],
  ['timeout + sh -c deliver', 'timeout 60 sh -c "pnpm dx-release-deliver"'],

  // --- paths: argv[0] is a path, so an exact-name match misses ---
  ['absolute path to gh', '/opt/homebrew/bin/gh workflow run x'],
  ['relative path to gh', './bin/gh run rerun 7'],
  ['absolute path to ik', '/usr/local/bin/ik release deliver'],
  ['absolute path to the deliver binary', '/usr/local/bin/dx-release-deliver'],
  ['bare dx-release-deliver as argv[0]', 'dx-release-deliver'],
  ['release-deliver as argv[0]', 'release-deliver'],

  // --- prefix commands: stripped so the real command reaches argv[0] ---
  ['env gh', 'env gh workflow run x'],
  ['/usr/bin/env gh', '/usr/bin/env gh workflow run x'],
  ['env assign + gh api dispatches', `env GH_TOKEN=x gh api ${PATH} -f a=1`],
  ['command gh', 'command gh workflow run x'],
  ['exec gh', 'exec gh workflow run x'],
  ['eval gh', 'eval gh workflow run x'],
  ['nohup gh', 'nohup gh workflow run x'],
  ['xargs gh via pipe', 'echo x | xargs gh workflow run'],
  ['sudo + env + path', 'sudo env GH_TOKEN=x /opt/homebrew/bin/gh workflow run x'],
];

// The raw scan reads the WHOLE command, so a wrapper anywhere re-arms the phrase everywhere. These
// over-block, accepted: scoping the scan to the wrapper's segment fails OPEN instead.
const BLOCKED_ACCEPTED_FALSE_DENIES = [
  ['phrase quoted inside a payload', `bash -c "echo 'gh workflow run'"`],
  ['wrapper in one segment, phrase in another', 'bash script.sh && grep "gh workflow run" f'],
  ['shell named as a noun + phrase elsewhere', 'ls /bin/bash && grep "gh workflow run" f'],
  ['unrelated path containing /dispatches', 'bash -c "cat /var/log/dispatches/x"'],
];

const ALLOWED = [
  ['gh run list', 'gh run list'],
  ['gh run view', 'gh run view 1'],
  ['gh workflow view', 'gh workflow view w'],
  ['substring in grep arg', 'grep "gh workflow run" file.txt'],
  ['deploy-all is allowed', 'pnpm exec ik release deploy-all'],
  ['plain build', 'pnpm run build'],
  ['dispatches in a non-gh command', 'ls dispatches/'],

  // --- reads stay open inside a wrapper too ---
  ['wrapped gh run list', 'bash -c "gh run list"'],
  ['wrapped gh workflow view', 'bash -c "gh workflow view w"'],
  // These two pin the RE_RAW_GH_API && RE_DISPATCH conjunction. Dropping the AND is the most
  // likely implementation error, and it would deny a read CLAUDE.md explicitly blesses.
  ['wrapped gh api, non-dispatch', 'bash -c "gh api repos/o/r"'],
  ['wrapped gh api user', 'bash -c "gh api user"'],
  ['wrapped build', 'bash -c "pnpm run build"'],
  ['wrapped deploy-all', 'bash -c "pnpm exec ik release deploy-all"'],

  ['bash script.sh — the file is never read', 'bash script.sh'],
  ['sh -x script', 'sh -x scripts/notes.sh'],
  ['path to gh, read verb', '/opt/homebrew/bin/gh run list'],
  ['env assignment + test', 'env NODE_ENV=test pnpm test'],
  ['time + build', 'time pnpm run build'],
  ['ls the gh binary', 'ls /opt/homebrew/bin/gh'],
  ['assignment-only segment must not fail closed', 'FOO=bar && pnpm test'],
  ['which bash', 'which bash'],
  ['echo bash', 'echo bash'],
  ['shell as a filename, phrase in another segment', 'cat bash-notes.txt && grep "gh workflow run" f'],
  ['command -v', 'command -v pnpm'],
  ['dispatches without a leading slash + wrapper', 'rg dispatches . && bash x.sh'],
];

// One theory of "deliver" across all three call sites: a dx-/release- prefixed name counts
// anywhere, a bare `deliver` needs an infra-kit tool beside it. Without that, adding a wrapper
// could turn a denied execution into an allowed one.
const ALLOWED_DELIVER_BOUNDARY = [
  ['bare scripts/deliver', 'scripts/deliver'],
  ['wrapped scripts/deliver', 'bash -c "scripts/deliver x"'],
  ['sh scripts/deliver', 'sh scripts/deliver'],
  ['deliver as English in a commit message', 'bash -c "git commit -m \\"feat: deliver emails\\""'],
  ['rg deliver + a wrapper elsewhere', 'rg deliver .omc/plans/ && bash scripts/x.sh'],
  ['which bash + rg deliver', 'which bash && rg deliver .'],
  ['quote-boundary coherence', 'git commit -m "pin bash " && rg deliver .'],
];

test('block-deploy DENIES every bypass via permissionDecision (exit 0 + deny JSON)', () => {
  for (const [label, command] of BLOCKED) {
    const d = decision(command);
    assert.ok(d.denied, `should deny: ${label}`);
    assert.equal(d.status, 0, `deny must exit 0 (JSON channel): ${label}`);
  }
});

test('block-deploy over-blocks these, knowingly (raw scan is command-wide)', () => {
  for (const [label, command] of BLOCKED_ACCEPTED_FALSE_DENIES) {
    const d = decision(command);
    assert.ok(d.denied, `accepted false deny should deny: ${label}`);
    assert.equal(d.status, 0, label);
  }
});

test('block-deploy allows read paths and non-deploy commands (no deny)', () => {
  for (const [label, command] of ALLOWED) {
    const d = decision(command);
    assert.equal(d.denied, false, `should allow: ${label}`);
    assert.equal(d.status, 0, label);
  }
});

test('block-deploy applies one consistent theory of "deliver" (bare vs self-identifying)', () => {
  for (const [label, command] of ALLOWED_DELIVER_BOUNDARY) {
    const d = decision(command);
    assert.equal(d.denied, false, `should allow: ${label}`);
    assert.equal(d.status, 0, label);
  }
});

test('block-deploy fails closed when prefix stripping consumes the whole command', () => {
  // Accepted cost: the bare-prefix family fail-closes, so `env | grep DOPPLER` denies.
  for (const command of ['echo x | xargs', 'env | grep DOPPLER', 'env | sort', 'env', 'time', 'sudo']) {
    assert.ok(decision(command).denied, `stripped-to-empty must deny, never silently pass: ${command}`);
  }
});

test('block-deploy fails closed on malformed / empty / missing tool_name (deny JSON)', () => {
  assert.ok(decision(null).denied, 'malformed → deny');
  assert.ok(runHook(HOOK, '').stdout.includes('deny'), 'empty stdin → deny');
  assert.ok(runHook(HOOK, { tool_name: '' }).stdout.includes('deny'), 'missing tool_name → deny');
});

test('block-deploy ignores non-Bash tools and empty commands (no deny, exit 0)', () => {
  const read = runHook(HOOK, { tool_name: 'Read', tool_input: {} });
  assert.equal(/permissionDecision/.test(read.stdout), false);
  assert.equal(read.status, 0);
  const empty = runHook(HOOK, { tool_name: 'Bash', tool_input: {} });
  assert.equal(/permissionDecision/.test(empty.stdout), false);
  assert.equal(empty.status, 0);
});

test('block-deploy is mode-independent (denies even with the exec bit stripped)', () => {
  assert.ok(decision('gh workflow run deploy.yml', { chmodStrip: true }).denied);
});
