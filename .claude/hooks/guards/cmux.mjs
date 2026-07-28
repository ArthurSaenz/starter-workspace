// Dev servers must run inside a cmux session (so they survive and stay inspectable). Blocks
// `pnpm dev` / `pnpm run dev` unless the command already mentions cmux.

import { HEAD_PREFIX, splitIntoSegments } from '../hooklib.mjs';

export const name = 'cmux';

// SEGMENTS INTERNALLY RATHER THAN EXPORTING scope = 'segment', which is why `scope` stays unset.
// The dispatcher hands a segment-scoped guard one segment at a time, and hooklib's splitter is
// quote-blind — so `cmux new-session -d -s dev "cd apps/client && pnpm dev"` arrives as two
// segments, and the one carrying `pnpm dev` can no longer see the `cmux` that authorises it.
// The escape needs the whole command, the match needs a head anchor; splitting here gets both.
//
// Head-anchored because this guard BLOCKS, and unanchored it stopped `rg "pnpm dev" docs/`.
// No trailing token boundary, so `pnpm dev:client` keeps blocking exactly as it always did.
const RE_DEV_SERVER = new RegExp(String.raw`${HEAD_PREFIX}pnpm\s+(run\s+)?dev`, 'i');

export function check(command) {
  if (command.includes('cmux')) return null;

  const startsDevServer = splitIntoSegments(command).some((segment) => RE_DEV_SERVER.test(segment));
  if (startsDevServer) {
    return {
      action: 'block',
      message: 'Dev servers must run in cmux. Use: cmux new-session -d -s dev "pnpm dev"',
    };
  }

  return null;
}
