import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { Exec, ExecOptions } from '../exec.ts'
import type { RunDeps } from '../run.ts'
import { GRADLE_PATH, PBXPROJ_PATH, main } from '../run.ts'
import type { FixtureApp } from './fixture-app.ts'
import { createFixtureApp } from './fixture-app.ts'

const DOMAIN = 'https://dev.example.com'
const REMOTE_ENTRY = `${DOMAIN}/mfe/remoteEntry.js`
const IOS_ASSETS = 'ios/App/App/public/assets'
const ANDROID_ASSETS = 'android/app/src/main/assets/public/assets'

interface Call {
  command: string
  cwd: string
  env: ExecOptions['env']
}

const createDeps = (
  app: FixtureApp,
  statusFor: (command: string) => number = () => {
    return 0
  },
) => {
  const calls: Call[] = []
  const lines: string[] = []

  const exec: Exec = (file, args, options) => {
    const command = [file, ...args].join(' ')

    calls.push({ command, cwd: options.cwd, env: options.env })

    if (command === 'pnpm run sync') {
      app.write(`${IOS_ASSETS}/index-a1.js`, `import("${REMOTE_ENTRY}")`)
      app.write(`${ANDROID_ASSETS}/index-a1.js`, `import("${REMOTE_ENTRY}")`)
    }

    return { status: statusFor(command), stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  }

  const deps: RunDeps = {
    exec: vi.fn(exec),
    cwd: app.appDir,
    env: { PATH: '/usr/bin' },
    log: (line) => {
      lines.push(line)
    },
    warn: (line) => {
      lines.push(`WARN ${line}`)
    },
    error: (line) => {
      lines.push(`ERROR ${line}`)
    },
    xcodeDeveloperDir: mkdtempSync(resolve(tmpdir(), 'xcode-')),
  }

  return { deps, calls, lines }
}

const hashNativeFiles = (app: FixtureApp): string => {
  return createHash('sha256').update(app.read(GRADLE_PATH)).update(app.read(PBXPROJ_PATH)).digest('hex')
}

const ARGV = ['dev', '--domain', DOMAIN, '--version', '10.9.14']

describe('main', () => {
  it('stamps, builds at the root, builds and syncs in the app, then asserts both bundles', () => {
    const app = createFixtureApp()
    const { deps, calls, lines } = createDeps(app)

    expect(main(ARGV, deps)).toBe(0)

    expect(
      calls.map(({ command, cwd }) => {
        return [command, cwd]
      }),
    ).toEqual([
      ['pnpm exec turbo build --filter=mobile-app^... --output-logs=errors-only', app.root],
      ['pnpm run _build', app.appDir],
      ['pnpm run sync', app.appDir],
    ])
    expect(calls[1]?.env).toMatchObject({ VITE_MOBILE_DOMAIN_URL: DOMAIN, PATH: '/usr/bin' })
    expect(calls[1]?.env).not.toHaveProperty('DEVELOPER_DIR')
    expect(calls[2]?.env).toMatchObject({ VITE_MOBILE_DOMAIN_URL: DOMAIN, DEVELOPER_DIR: deps.xcodeDeveloperDir })
    expect(lines[0]).toBe(`dev · 10.0.0 → 10.9.14 · iOS 5063 · Android 2000000041 · ${DOMAIN}`)
    expect(app.read(GRADLE_PATH)).toContain('versionCode 2000000041')
    expect(app.read(PBXPROJ_PATH)).toContain('MARKETING_VERSION = 10.9.14;')
    expect(lines).toContain(`✓ ${resolve(app.appDir, IOS_ASSETS)} → ${REMOTE_ENTRY}`)
    expect(lines).toContain(`✓ ${resolve(app.appDir, ANDROID_ASSETS)} → ${REMOTE_ENTRY}`)
  })

  it('keeps the build numbers when the marketing version is unchanged', () => {
    const app = createFixtureApp()
    const { deps, lines } = createDeps(app)

    expect(main(['prod', '--domain', DOMAIN, '--version', '10.0.0'], deps)).toBe(0)
    expect(lines[0]).toBe(`prod · 10.0.0 → 10.0.0 · iOS 5062 · Android 2000000040 · ${DOMAIN}`)
  })

  it('leaves DEVELOPER_DIR unset when Xcode is not installed there', () => {
    const app = createFixtureApp()
    const { deps, calls } = createDeps(app)

    expect(main(ARGV, { ...deps, xcodeDeveloperDir: '/nonexistent/Xcode' })).toBe(0)
    expect(calls[2]?.env).not.toHaveProperty('DEVELOPER_DIR')
  })

  it('warns on a non-zero cap sync and still gates on the bundle assertion', () => {
    const app = createFixtureApp()

    const { deps, lines } = createDeps(app, (command) => {
      return command === 'pnpm run sync' ? 1 : 0
    })

    expect(main(ARGV, deps)).toBe(0)
    expect(lines).toContain('WARN \ncap sync exited with 1; checking the copied bundle anyway')
  })

  it('exits 1 when cap sync failed before copying the bundle', () => {
    const app = createFixtureApp()
    const { deps, lines } = createDeps(app)

    const exec: Exec = (file, args) => {
      return {
        status: [file, ...args].join(' ') === 'pnpm run sync' ? 1 : 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      }
    }

    expect(main(ARGV, { ...deps, exec })).toBe(1)
    expect(lines.at(-1)).toBe(`ERROR ${resolve(app.appDir, IOS_ASSETS)} does not reference ${REMOTE_ENTRY}`)
  })

  it('exits 1 when a build command fails, before cap sync', () => {
    const app = createFixtureApp()

    const { deps, calls } = createDeps(app, (command) => {
      return command === 'pnpm run _build' ? 3 : 0
    })

    expect(main(ARGV, deps)).toBe(1)
    expect(calls.at(-1)?.command).toBe('pnpm run _build')
  })

  it('--dry-run writes nothing and runs nothing', () => {
    const app = createFixtureApp()
    const { deps, calls, lines } = createDeps(app)
    const before = hashNativeFiles(app)

    expect(main([...ARGV, '--dry-run'], deps)).toBe(0)
    expect(hashNativeFiles(app)).toBe(before)
    expect(calls).toEqual([])
    expect(lines[0]).toContain('dev · 10.0.0 → 10.9.14')
  })

  it('exits 2 on a mismatching VITE_MOBILE_DOMAIN_URL', () => {
    const app = createFixtureApp()
    const { deps, calls } = createDeps(app)

    expect(main(ARGV, { ...deps, env: { VITE_MOBILE_DOMAIN_URL: 'https://www.example.com' } })).toBe(2)
    expect(calls).toEqual([])
  })

  it.each([
    [
      'the native files',
      (app: FixtureApp) => {
        return { ...app, appDir: app.root }
      },
    ],
    [
      'a sync script',
      (app: FixtureApp) => {
        app.write('package.json', JSON.stringify({ name: 'mobile-app', scripts: { _build: 'vite build' } }))

        return app
      },
    ],
    [
      'a package name',
      (app: FixtureApp) => {
        app.write('package.json', JSON.stringify({ scripts: { _build: 'vite build', sync: 'cap sync' } }))

        return app
      },
    ],
  ])('exits 2 when the app dir lacks %s', (_name, breakApp) => {
    const app = breakApp(createFixtureApp())
    const { deps } = createDeps(app)

    expect(main(ARGV, { ...deps, cwd: app.appDir })).toBe(2)
  })

  it('exits 2 without a pnpm-workspace.yaml above the app', () => {
    const app = createFixtureApp()
    const { deps, calls } = createDeps(app)

    rmSync(resolve(app.root, 'pnpm-workspace.yaml'))

    expect(main(ARGV, deps)).toBe(2)
    expect(calls).toEqual([])
  })

  it('prints the usage on --help', () => {
    const app = createFixtureApp()
    const { deps, lines } = createDeps(app)

    expect(main(['--help'], deps)).toBe(0)
    expect(lines[0]).toContain('--domain')
  })
})
