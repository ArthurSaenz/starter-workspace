import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Exec, ExecOptions } from '../exec.ts'
import type { RunDeps } from '../run.ts'
import { GRADLE_PATH, PBXPROJ_PATH, main } from '../run.ts'
import type { FixtureApp } from './fixture-app.ts'
import { createFixtureApp, git, isolatedExec } from './fixture-app.ts'

const DOMAIN = 'https://dev.example.com'
const REMOTE_ENTRY = `${DOMAIN}/mfe/remoteEntry.js`
const IOS_ASSETS = 'ios/App/App/public/assets'
const ANDROID_ASSETS = 'android/app/src/main/assets/public/assets'
const READ_ONLY_GIT = new Set(['rev-parse', 'log', 'cat-file'])

interface Call {
  command: string
  cwd: string
  env: ExecOptions['env']
}

const EMPTY = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }

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

    if (file === 'git' && READ_ONLY_GIT.has(args[0] ?? '')) return isolatedExec(file, args, options)

    calls.push({ command, cwd: options.cwd, env: options.env })

    if (command === 'pnpm run sync') {
      app.write(`${IOS_ASSETS}/index-a1.js`, `import("${REMOTE_ENTRY}")`)
      app.write(`${ANDROID_ASSETS}/index-a1.js`, `import("${REMOTE_ENTRY}")`)
    }

    return { status: statusFor(command), ...EMPTY }
  }

  const deps: RunDeps = {
    exec,
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

const planLine = (lines: string[]): string | undefined => {
  return lines.find((line) => {
    return line.includes(' → ')
  })
}

const hashNativeFiles = (app: FixtureApp): string => {
  return createHash('sha256').update(app.read(GRADLE_PATH)).update(app.read(PBXPROJ_PATH)).digest('hex')
}

const ARGV = ['dev', '--domain', DOMAIN]

describe('main', () => {
  it('fetches, stamps, builds at the root, builds and syncs in the app, asserts both bundles, then hands off', () => {
    const app = createFixtureApp()
    const { deps, calls, lines } = createDeps(app)

    expect(main(ARGV, deps)).toBe(0)

    expect(
      calls.map(({ command, cwd }) => {
        return [command, cwd]
      }),
    ).toEqual([
      ['git fetch origin --quiet', app.appDir],
      ['pnpm exec turbo build --filter=mobile-app^... --output-logs=errors-only', app.root],
      ['pnpm run _build', app.appDir],
      ['pnpm run sync', app.appDir],
    ])
    expect(calls[1]?.env).toMatchObject({ VITE_MOBILE_DOMAIN_URL: DOMAIN, PATH: '/usr/bin' })
    expect(calls[2]?.env).toMatchObject({ VITE_MOBILE_DOMAIN_URL: DOMAIN })
    expect(calls[2]?.env).not.toHaveProperty('DEVELOPER_DIR')
    expect(calls[3]?.env).toMatchObject({ VITE_MOBILE_DOMAIN_URL: DOMAIN, DEVELOPER_DIR: deps.xcodeDeveloperDir })
    expect(planLine(lines)).toBe(
      `dev · 10.0.0 → 10.9.9 · iOS 5063 · Android 2000000041 · ${DOMAIN} · builds after iOS HEAD, Android HEAD`,
    )
    expect(app.read(GRADLE_PATH)).toContain('versionCode 2000000041')
    expect(app.read(PBXPROJ_PATH)).toContain('MARKETING_VERSION = 10.9.9;')
    expect(lines).toContain(`✓ ${resolve(app.appDir, IOS_ASSETS)} → ${REMOTE_ENTRY}`)
    expect(lines).toContain(`✓ ${resolve(app.appDir, ANDROID_ASSETS)} → ${REMOTE_ENTRY}`)
    expect(lines.slice(-2)).toEqual([
      `review \`git diff -- ${GRADLE_PATH} ${PBXPROJ_PATH}\` first: \`cap sync\` may have changed more than the version lines`,
      `git commit -m "[APP] Stamp mobile-app 10.9.9 for the dev native build (Android 2000000041, iOS build 5063)" -- ${GRADLE_PATH} ${PBXPROJ_PATH}`,
    ])
  })

  it('re-running an unfinished build writes nothing new and stamps the same values', () => {
    const app = createFixtureApp()
    const first = createDeps(app)

    expect(main(ARGV, first.deps)).toBe(0)

    const stamped = hashNativeFiles(app)
    const second = createDeps(app)

    expect(main(ARGV, second.deps)).toBe(0)
    expect(hashNativeFiles(app)).toBe(stamped)
    expect(planLine(second.lines)).toBe(planLine(first.lines))
  })

  it('exits 2 on a hand-edited version line in the working tree', () => {
    const app = createFixtureApp()
    const { deps, calls, lines } = createDeps(app)

    app.write(GRADLE_PATH, app.read(GRADLE_PATH).replace('versionCode 2000000040', 'versionCode 2000000099'))

    expect(main(ARGV, deps)).toBe(2)
    expect(lines.at(-1)).toContain('commit it if that build was uploaded')
    expect(
      calls.map(({ command }) => {
        return command
      }),
    ).toEqual(['git fetch origin --quiet'])
  })

  it('refuses a plain prod of a delivered version and accepts the --version confirmation', () => {
    const app = createFixtureApp()

    git(app.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

    const refused = createDeps(app)

    expect(main(['prod', '--domain', DOMAIN, '--dry-run'], refused.deps)).toBe(2)
    expect(refused.lines.at(-1)).toContain('prod 10.0.0 is already delivered on origin/main')

    const confirmed = createDeps(app)

    expect(main(['prod', '--domain', DOMAIN, '--version', '10.0.0'], confirmed.deps)).toBe(0)
    expect(planLine(confirmed.lines)).toContain('prod · 10.0.0 → 10.0.0 · iOS 5063 · Android 2000000041')
  })

  it('leaves DEVELOPER_DIR unset when Xcode is not installed there', () => {
    const app = createFixtureApp()
    const { deps, calls } = createDeps(app)

    expect(main(ARGV, { ...deps, xcodeDeveloperDir: '/nonexistent/Xcode' })).toBe(0)
    expect(calls.at(-1)?.env).not.toHaveProperty('DEVELOPER_DIR')
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

    const exec: Exec = (file, args, options) => {
      if (file === 'git') return args[0] === 'fetch' ? { status: 0, ...EMPTY } : isolatedExec(file, args, options)

      return { status: [file, ...args].join(' ') === 'pnpm run sync' ? 1 : 0, ...EMPTY }
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

  it('exits 2 when git fetch fails', () => {
    const app = createFixtureApp()

    const { deps, calls } = createDeps(app, (command) => {
      return command === 'git fetch origin --quiet' ? 128 : 0
    })

    expect(main(ARGV, deps)).toBe(2)
    expect(calls).toHaveLength(1)
  })

  it('--dry-run writes nothing, runs nothing but git fetch, and prints the next-major hint', () => {
    const app = createFixtureApp()
    const { deps, calls, lines } = createDeps(app)
    const before = hashNativeFiles(app)

    expect(main([...ARGV, '--version', '10.9.99', '--dry-run'], deps)).toBe(0)
    expect(hashNativeFiles(app)).toBe(before)
    expect(
      calls.map(({ command }) => {
        return command
      }),
    ).toEqual(['git fetch origin --quiet'])
    expect(planLine(lines)).toContain('dev · 10.0.0 → 10.9.99')
    expect(lines.at(-1)).toBe('next major: pnpm run build-native-prod --version 11.0.0')
  })

  it('bases the --dry-run hint on a --version major above HEAD', () => {
    const app = createFixtureApp()
    const { deps, lines } = createDeps(app)

    expect(main(['prod', '--domain', DOMAIN, '--version', '11.0.0', '--dry-run'], deps)).toBe(0)
    expect(lines.at(-1)).toBe('next major: pnpm run build-native-prod --version 12.0.0')
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
    const { deps, calls } = createDeps(app)

    expect(main(ARGV, { ...deps, cwd: app.appDir })).toBe(2)
    expect(calls).toEqual([])
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
