import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runHook, edit, HOOKS_DIR } from './helpers.mjs';
import { findPackageDir } from '../hooklib.mjs';

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
