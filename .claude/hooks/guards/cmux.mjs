// Dev servers must run inside a cmux session (so they survive and stay inspectable). Blocks
// `pnpm dev` / `pnpm run dev` unless the command already mentions cmux.

import { HEAD_PREFIX, splitIntoSegments } from '../hooklib.mjs';

export const name = 'cmux';

// Segments internally rather than exporting scope='segment', so `scope` stays unset: the splitter
// is quote-blind, and a segmented `cmux new-session … "cd x && pnpm dev"` loses the `cmux` that
// authorises it. Head-anchored because unanchored this blocked `rg "pnpm dev" docs/`; no trailing
// boundary, so `pnpm dev:client` still blocks.
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
