#!/usr/bin/env node
// Runs the advisory Bash guards in one process; first block wins. A guard that throws fails open,
// so one bug can't swallow the rest. The deploy guard is separate — it fails closed.
//
// `scope = 'segment'` calls a guard per shell segment, so its ^-anchored regexes match in
// `cd /repo && git worktree add ...`. Opt-in: `style` and `cmux` read the whole line by design.

import { readInput, block, addContext, allow, splitIntoSegments } from './hooklib.mjs';
import * as doppler from './guards/doppler.mjs';
import * as destructive from './guards/destructive.mjs';
import * as packageManager from './guards/package-manager.mjs';
import * as style from './guards/style.mjs';
import * as cmux from './guards/cmux.mjs';
import * as worktree from './guards/worktree.mjs';

// `doppler` first: when a command trips two guards, the one about secrets is worth showing.
const GUARDS = [doppler, destructive, packageManager, style, cmux, worktree];

let input;
try {
  input = readInput();
} catch {
  allow(); // malformed event: advisory guards fail open
}

if (input.toolName !== 'Bash' || !input.command) allow();

const segments = splitIntoSegments(input.command);

// First decision a guard returns across its inputs; segment-scoped guards stop at the first hit.
function decide(guard) {
  const inputs = guard.scope === 'segment' ? segments : [input.command];

  for (const text of inputs) {
    const decision = guard.check(text);
    if (decision) return decision;
  }

  return null;
}

let advice = null;

for (const guard of GUARDS) {
  let decision;
  try {
    decision = decide(guard);
  } catch (err) {
    process.stderr.write(`bash-guard: guard "${guard.name}" failed open: ${err.message}\n`);
    continue;
  }

  if (!decision) continue;
  if (decision.action === 'block') block(decision.message);
  if (decision.action === 'advise' && advice === null) advice = decision.context;
}

if (advice !== null) addContext(advice);
allow();
