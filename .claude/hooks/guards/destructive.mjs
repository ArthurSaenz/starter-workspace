// Blocks recursive force-remove, force push, and SQL drops/truncates. Head-anchored per segment, so
// it fires on the command being RUN, not on `echo "rm -rf /"`. Case-insensitive: macOS resolves
// `RM -RF`. Not covered: wrapper payloads, aliases, `/bin/rm -rf x`, `psql -c "drop table users"`.

import { HEAD_PREFIX, argvAfterPrefix } from '../hooklib.mjs';

export const name = 'destructive';

export const scope = 'segment';

// Both flags, any spelling. Plain `rm -r some/dir` is routine, so `-r` alone must not block. Every
// flag token is scanned, not just the one after `rm`, which is what catches `rm -f -r ./dist`.
function isForceRecursiveRemove(argv) {
  if (argv[0]?.toLowerCase() !== 'rm') return false;

  let recursive = false;
  let force = false;

  for (const token of argv.slice(1)) {
    if (!token.startsWith('-')) continue;

    if (token.startsWith('--')) {
      if (token.toLowerCase() === '--recursive') recursive = true;
      if (token.toLowerCase() === '--force') force = true;
      continue;
    }

    const flags = token.slice(1);
    if (/[rR]/.test(flags)) recursive = true;
    if (/f/.test(flags)) force = true;
  }

  return recursive && force;
}

const RE_GIT_PUSH = new RegExp(`${HEAD_PREFIX}git\\s+push\\b`, 'i');
// Bare force only. `--force-with-lease` and `--force-if-includes` continue past the lookahead.
const RE_FORCE_FLAG = /(^|\s)(-f|--force)(?=\s|$)/;

// Near-dead after anchoring, kept knowingly: what remains is a heredoc fed to a SQL client, plus
// coreutils `truncate -s 0 file`.
const RE_SQL = new RegExp(`${HEAD_PREFIX}(drop\\s+(table|database)\\b|truncate\\s)`, 'i');

export function check(command) {
  if (isForceRecursiveRemove(argvAfterPrefix(command))) {
    return { action: 'block', message: 'Blocked: recursive force-remove.' };
  }

  if (RE_GIT_PUSH.test(command) && RE_FORCE_FLAG.test(command)) {
    return {
      action: 'block',
      message:
        'Blocked: force push. Use --force-with-lease, which refuses when the remote has moved.',
    };
  }

  if (RE_SQL.test(command)) {
    return { action: 'block', message: 'Blocked: destructive SQL (drop/truncate).' };
  }

  return null;
}
