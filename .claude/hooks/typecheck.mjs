#!/usr/bin/env node
// After a .ts/.tsx edit, runs an INCREMENTAL `tsc --noEmit` in the file's package and reports
// failures via systemMessage. Never blocks. Skips files outside a package or with no tsconfig.
// Incremental (--tsBuildInfoFile under the package's gitignored node_modules cache) keeps the
// second and later edits to a package cheap instead of re-checking the whole program each save.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readInput, systemMessage, allow, findPackageDir } from './hooklib.mjs';

let input;
try {
  input = readInput();
} catch {
  allow();
}

const filePath = input.filePath;
if (!/\.(ts|tsx)$/.test(filePath)) allow();

const pkgDir = findPackageDir(filePath);
if (!pkgDir || !existsSync(join(pkgDir, 'tsconfig.json'))) allow();

// tsc won't create intermediate dirs, so ensure the cache dir exists first.
const tsBuildInfo = join(pkgDir, 'node_modules', '.cache', 'hook-tsc.tsbuildinfo');
mkdirSync(dirname(tsBuildInfo), { recursive: true });

const result = spawnSync(
  'pnpm',
  ['exec', 'tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', tsBuildInfo],
  { cwd: pkgDir, encoding: 'utf8' },
);

if (result.status !== 0) {
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  systemMessage(`Type errors found after editing ${resolve(filePath)}: ${output}`);
}

allow();
