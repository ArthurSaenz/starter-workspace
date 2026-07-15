import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHook, bash } from './helpers.mjs';

const HOOK = 'block-deploy.mjs';
const status = (command, opts) => runHook(HOOK, bash(command), opts).status;

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
];

const ALLOWED = [
  ['gh run list', 'gh run list'],
  ['gh run view', 'gh run view 1'],
  ['gh workflow view', 'gh workflow view w'],
  ['substring in grep arg', 'grep "gh workflow run" file.txt'],
  ['quoted-URL edge (documented tripwire limit)', 'gh api "https://api.github.com/repos/o/r/actions/workflows/w.yml/dispatches" -f x=1'],
  ['deploy-all is allowed', 'pnpm exec ik release deploy-all'],
  ['plain build', 'pnpm run build'],
  ['dispatches in a non-gh command', 'ls dispatches/'],
];

test('block-deploy blocks every bypass (exit 2)', () => {
  for (const [label, command] of BLOCKED) {
    assert.equal(status(command), 2, label);
  }
});

test('block-deploy allows read paths and non-deploy commands (exit 0)', () => {
  for (const [label, command] of ALLOWED) {
    assert.equal(status(command), 0, label);
  }
});

test('block-deploy fails closed on malformed / empty / missing tool_name', () => {
  assert.equal(runHook(HOOK, '{bad json').status, 2);
  assert.equal(runHook(HOOK, '').status, 2);
  assert.equal(runHook(HOOK, { tool_name: '' }).status, 2);
});

test('block-deploy ignores non-Bash tools and empty commands (exit 0)', () => {
  assert.equal(runHook(HOOK, { tool_name: 'Read', tool_input: {} }).status, 0);
  assert.equal(runHook(HOOK, { tool_name: 'Bash', tool_input: {} }).status, 0);
});

test('block-deploy is mode-independent (blocks even with the exec bit stripped)', () => {
  assert.equal(status('gh workflow run deploy.yml', { chmodStrip: true }), 2);
});
