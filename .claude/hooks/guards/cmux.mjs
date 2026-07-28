// Dev servers must run inside a cmux session (so they survive and stay inspectable). Blocks
// `pnpm dev` / `pnpm run dev` unless the command already mentions cmux.

import { HEAD_PREFIX, splitIntoSegments } from '../hooklib.mjs';

export const name = 'cmux';

// SEGMENTS INTERNALLY instead of exporting scope = 'segment', hence `scope` stays unset: the
// splitter is quote-blind, so `cmux new-session -d -s dev "cd apps/client && pnpm dev"` splits and
// the segment holding `pnpm dev` can no longer see the `cmux` authorising it. The escape needs the
// whole command, the match needs a head anchor — unanchored, this blocked `rg "pnpm dev" docs/`.
// No trailing boundary, so `pnpm dev:client` keeps blocking as before.
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
