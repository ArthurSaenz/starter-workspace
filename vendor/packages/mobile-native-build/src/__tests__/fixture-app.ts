import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { Exec } from '../exec.ts'
import { spawnExec } from '../exec.ts'

export const readFixture = (name: string): string => {
  return readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8')
}

const ISOLATED_GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

/** The real exec, isolated from the developer's global git config so signing or hooks cannot interfere. */
export const isolatedExec: Exec = (file, args, options) => {
  return spawnExec(file, args, { ...options, env: options.env ?? ISOLATED_GIT_ENV })
}

export const git = (cwd: string, ...args: string[]): string => {
  const result = isolatedExec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    capture: true,
  })

  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)

  return result.stdout.toString().trim()
}

export interface FixtureApp {
  root: string
  appDir: string
  write: (path: string, content: string) => void
  read: (path: string) => string
  commit: (message: string) => string
}

/** A git repo root holding a Capacitor app at `apps/mobile`, with the native files committed on `main`. */
export const createFixtureApp = (repo: 'hulyo' | 'travelist' = 'hulyo'): FixtureApp => {
  const root = mkdtempSync(resolve(tmpdir(), 'mobile-native-build-'))
  const appDir = resolve(root, 'apps/mobile')

  const write = (path: string, content: string): void => {
    const file = resolve(appDir, path)

    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  writeFileSync(resolve(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
  write('package.json', JSON.stringify({ name: 'mobile-app', scripts: { _build: 'vite build', sync: 'cap sync' } }))
  write('android/app/build.gradle', readFixture(`${repo}-build.gradle`))
  write('ios/App/App.xcodeproj/project.pbxproj', readFixture(`${repo}-project.pbxproj`))

  const commit = (message: string): string => {
    git(root, 'add', '-A')
    git(root, 'commit', '--quiet', '--allow-empty', '-m', message)

    return git(root, 'rev-parse', 'HEAD')
  }

  git(root, 'init', '--quiet', '--initial-branch=main')
  commit('initial')

  return {
    root,
    appDir,
    write,
    commit,
    read: (path) => {
      return readFileSync(resolve(appDir, path), 'utf8')
    },
  }
}
