// `doppler secrets` prints secret VALUES to a permanently transcribed stdout, so this blocks rather
// than advises. Gated on the SUBCOMMAND, not flags — `secrets get X` prints values without `--plain`
// too. Not covered: `cat .env`, `env`, `doppler run -- env`, aliases, paths, `--copy`.

import { HEAD_PREFIX } from '../hooklib.mjs';

export const name = 'doppler';

export const scope = 'segment';

const RE_DOPPLER_SECRETS = new RegExp(`${HEAD_PREFIX}doppler\\s+secrets(?=\\s|$)`, 'i');

const MESSAGE = [
  '`doppler secrets` prints secret values to stdout, and stdout is kept in this transcript',
  'permanently. Load env the repo\'s way instead:',
  '    doppler secrets download --no-file   ->  ik env-load -c <config>',
  '    doppler secrets get X --plain        ->  ik env-load -c <config>, then read it in-process',
  '',
  '`ik env-load` runs the same download and prints a 0600 file path to source, not the values.',
  'To inspect without values: `ik env-status`.',
  '',
  'If a human genuinely needs one value, they run `doppler secrets get X --plain` in their own',
  'terminal or read it from the Doppler dashboard. This rule binds agents only.',
].join('\n');

export function check(command) {
  if (RE_DOPPLER_SECRETS.test(command)) {
    return { action: 'block', message: MESSAGE };
  }
  return null;
}
