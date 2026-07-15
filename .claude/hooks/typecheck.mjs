#!/usr/bin/env node
// After a .ts/.tsx edit, runs `tsc --noEmit` in the file's package and reports failures via
// systemMessage. Never blocks. Skips files outside a package or with no tsconfig.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

const result = spawnSync('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: pkgDir, encoding: 'utf8' });

if (result.status !== 0) {
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  systemMessage(`Type errors found after editing ${resolve(filePath)}: ${output}`);
}

allow();
