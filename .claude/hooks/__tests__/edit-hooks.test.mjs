import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runHook, edit, HOOKS_DIR } from './helpers.mjs';
import { findPackageDir } from '../hooklib.mjs';

const REPO_ROOT = resolve(HOOKS_DIR, '..', '..');

// Find a real package (tsconfig.json + a non-.d.ts source) to exercise the incremental typecheck.
// Returns null if none is available so the test can skip instead of failing on a partial checkout.
function findTypecheckablePackage() {
  let hit = null;
  const walk = (dir, depth) => {
    if (hit || depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'tsconfig.json')) {
      const src = entries.find((e) => e.isFile() && /(?<!\.d)\.ts$/.test(e.name));
      if (src) {
        hit = { pkgDir: dir, file: join(dir, src.name) };
        return;
      }
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) {
        walk(join(dir, e.name), depth + 1);
      }
    }
  };
  walk(REPO_ROOT, 0);
  return hit;
}

// -------------------------------------------------------------- protect-files

test('protect-files blocks the lockfile and .git/, allows everything else', () => {
  assert.equal(runHook('protect-files.mjs', edit('pnpm-lock.yaml')).status, 2);
  assert.equal(runHook('protect-files.mjs', edit('foo/.git/config')).status, 2);
  assert.equal(runHook('protect-files.mjs', edit('src/index.ts')).status, 0);
  assert.equal(runHook('protect-files.mjs', edit('.github/workflows/ci.yml')).status, 0); // NOT .git/
  assert.equal(runHook('protect-files.mjs', edit('src/.gitignore')).status, 0);
  assert.equal(runHook('protect-files.mjs', '{bad').status, 0); // fails open
});

// -------------------------------------------------------------- format/typecheck/test gating

// These shell out to per-package tooling only for matching files inside a package. For a
// non-matching path they must exit 0 with NO output and never spawn anything.
test('format/typecheck/test hooks no-op on a non-matching file (exit 0, no output)', () => {
  for (const file of ['auto-format.mjs', 'typecheck.mjs', 'run-tests-async.mjs']) {
    const res = runHook(file, edit('README.md'));
    assert.equal(res.status, 0, `${file} exit`);
    assert.equal(res.stdout, '', `${file} stdout`);
  }
});

test('auto-format emits no JSON (best-effort, never a systemMessage)', () => {
  const res = runHook('auto-format.mjs', edit('/nonexistent/x.mjs'));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('typecheck/run-tests skip files outside any package (exit 0, no output)', () => {
  for (const file of ['typecheck.mjs', 'run-tests-async.mjs']) {
    const res = runHook(file, edit('/nonexistent/deep/x.ts'));
    assert.equal(res.status, 0, `${file} exit`);
    assert.equal(res.stdout, '', `${file} stdout`);
  }
});

// -------------------------------------------------------------- quality-gate

test('quality-gate fails closed when CLAUDE_PROJECT_DIR is unset (exit 2)', () => {
  const res = runHook('quality-gate.mjs', { tool_name: 'Stop' }, { env: { CLAUDE_PROJECT_DIR: '' } });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /failing closed/);
});

// -------------------------------------------------------------- findPackageDir

test('findPackageDir returns the nearest ancestor holding a package.json', () => {
  const result = findPackageDir(join(HOOKS_DIR, 'block-deploy.mjs'));
  assert.ok(result, 'should resolve a package dir for a repo file');
  assert.ok(existsSync(join(result, 'package.json')));
});

test('findPackageDir returns null for a path outside any package', () => {
  assert.equal(findPackageDir('/nonexistent/deep/x.ts'), null);
});

// Locks the F2 incremental behavior: typecheck.mjs must write a .tsbuildinfo (only --incremental
// does that) and exit 0. Skips if no typecheckable package exists (partial checkout).
const pkg = findTypecheckablePackage();
test('typecheck.mjs writes an incremental tsbuildinfo and exits 0', { skip: !pkg }, () => {
  const tsBuildInfo = join(pkg.pkgDir, 'node_modules', '.cache', 'hook-tsc.tsbuildinfo');
  rmSync(tsBuildInfo, { force: true });

  const res = runHook('typecheck.mjs', edit(pkg.file));

  assert.equal(res.status, 0, 'typecheck must never block');
  assert.ok(existsSync(tsBuildInfo), 'incremental run must produce a tsbuildinfo');
});
