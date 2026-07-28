// npm and yarn write a competing lockfile and node_modules layout, so this BLOCKS. Anchored per
// segment, catching `cd apps/client && npm install` while leaving `pnpm exec npm-run-all` and
// `rg npm docs/` alone. Not covered: wrapper payloads, aliases, `$(echo npm) install`, paths.

import { HEAD_PREFIX } from '../hooklib.mjs';

export const name = 'package-manager';

export const scope = 'segment';

// `(?=\s|$)` is a token boundary, not `\b`, which sits happily before the hyphen in `npm-run-all`.
// `pnpm`/`pnpx` are safe by construction: a leading `p` fails the anchor before the alternation.
const RE_FOREIGN_PM = new RegExp(`${HEAD_PREFIX}(npm|yarn|npx)(?=\\s|$)`, 'i');

const MESSAGE = [
  'This is a pnpm workspace — npm and yarn write a competing lockfile and a node_modules layout',
  'pnpm did not plan. Use pnpm instead:',
  '    npm install / npm i / npm ci   ->  pnpm install',
  '    npm add x / yarn add x         ->  pnpm add x',
  '    npm run x / yarn x             ->  pnpm run x',
  '    npm exec x / npx x             ->  pnpm exec x   (or pnpm dlx x)',
].join('\n');

export function check(command) {
  if (RE_FOREIGN_PM.test(command)) {
    return { action: 'block', message: MESSAGE };
  }
  return null;
}
