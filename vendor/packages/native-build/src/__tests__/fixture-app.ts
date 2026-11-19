import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

export const readFixture = (name: string): string => {
  return readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8')
}

export interface FixtureApp {
  root: string
  appDir: string
  write: (path: string, content: string) => void
  read: (path: string) => string
}

/** A fake repo root holding a Capacitor app at `apps/mobile` with the hulyo native files. */
export const createFixtureApp = (repo: 'hulyo' | 'travelist' = 'hulyo'): FixtureApp => {
  const root = mkdtempSync(resolve(tmpdir(), 'native-build-'))
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

  return {
    root,
    appDir,
    write,
    read: (path) => {
      return readFileSync(resolve(appDir, path), 'utf8')
    },
  }
}
