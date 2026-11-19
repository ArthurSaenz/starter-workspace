import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { DELIVERED_REF, fetchOrigin, readGitState } from '../git-state.ts'
import { GRADLE_PATH, PBXPROJ_PATH } from '../run.ts'
import { stampIos } from '../version.ts'
import { createFixtureApp, git, isolatedExec } from './fixture-app.ts'

const PATHS = { gradle: GRADLE_PATH, pbxproj: PBXPROJ_PATH }

/** main at 10.0.0 / 5062, plus side refs that each test either counts or ignores. */
const createRepo = () => {
  const app = createFixtureApp()
  const mainSha = git(app.root, 'rev-parse', 'HEAD')
  const pbxproj = app.read(PBXPROJ_PATH)

  const commitOnSide = (ref: string, build: number) => {
    git(app.root, 'checkout', '--quiet', '-b', 'side')
    app.write(PBXPROJ_PATH, stampIos(pbxproj, { version: '10.9.20', build }))

    const sha = app.commit(`stamp ${build}`)

    git(app.root, 'checkout', '--quiet', 'main')
    git(app.root, 'update-ref', ref, sha)
    git(app.root, 'branch', '--quiet', '-D', 'side')

    return sha
  }

  return { app, mainSha, commitOnSide }
}

describe('readGitState', () => {
  it('reads HEAD and counts an origin ref, naming it as the source', () => {
    const { app, commitOnSide } = createRepo()

    commitOnSide('refs/remotes/origin/release/x', 5070)

    const state = readGitState(isolatedExec, app.appDir, PATHS)

    const sources = state.history.find((entry) => {
      return entry.ios?.build === 5070
    })

    expect(state.head.ios).toEqual({ version: '10.0.0', build: 5062 })
    expect(sources?.source).toMatch(/^origin\/release\/x \([0-9a-f]{9}\)$/)
    expect(sources?.ios?.version).toBe('10.9.20')
  })

  it('ignores refs outside heads and origin', () => {
    const { app, commitOnSide } = createRepo()

    commitOnSide('refs/claude/backup-wip', 9999)

    const builds = readGitState(isolatedExec, app.appDir, PATHS).history.map((entry) => {
      return entry.ios?.build
    })

    expect(builds).toEqual([5062])
  })

  it('skips a commit whose native files are gone', () => {
    const { app } = createRepo()

    git(app.root, 'checkout', '--quiet', '-b', 'feature/no-native')
    rmSync(resolve(app.appDir, 'android'), { recursive: true })
    rmSync(resolve(app.appDir, 'ios'), { recursive: true })
    app.commit('drop native')
    git(app.root, 'checkout', '--quiet', 'main')

    const { history } = readGitState(isolatedExec, app.appDir, PATHS)

    expect(history).toHaveLength(2)
    expect(
      history.find((entry) => {
        return entry.source.startsWith('feature/no-native')
      }),
    ).toMatchObject({ ios: undefined, android: undefined })
  })

  it('uses one cat-file --batch process, a --full-history log and repo-root-relative paths', () => {
    const { app } = createRepo()
    const exec = vi.fn(isolatedExec)

    readGitState(exec, app.appDir, PATHS)

    const calls = exec.mock.calls.map(([, args, options]) => {
      return { args, input: options.input }
    })

    const catFiles = calls.filter(({ args }) => {
      return args[0] === 'cat-file'
    })

    expect(catFiles).toHaveLength(1)
    expect(
      calls.find(({ args }) => {
        return args[0] === 'log' && args.includes('--source')
      })?.args,
    ).toEqual(
      expect.arrayContaining(['--full-history', '--branches', '--remotes=origin', '--', GRADLE_PATH, PBXPROJ_PATH]),
    )
    expect(catFiles[0]?.input?.split('\n').filter(Boolean)).toEqual(
      expect.arrayContaining([`HEAD:apps/mobile/${GRADLE_PATH}`, `HEAD:apps/mobile/${PBXPROJ_PATH}`]),
    )
    expect(
      catFiles[0]?.input
        ?.split('\n')
        .filter(Boolean)
        .every((line) => {
          return line.includes(':apps/mobile/')
        }),
    ).toBe(true)
  })

  it('reads the delivered line from origin/main, or reports it missing', () => {
    const { app, mainSha } = createRepo()

    expect(readGitState(isolatedExec, app.appDir, PATHS).delivered).toBeUndefined()

    git(app.root, 'update-ref', `refs/remotes/${DELIVERED_REF}`, mainSha)

    expect(readGitState(isolatedExec, app.appDir, PATHS).delivered).toEqual({
      ref: 'origin/main',
      commit: git(app.root, 'rev-parse', '--short', mainSha),
      date: git(app.root, 'log', '-1', '--format=%cs', mainSha),
      ios: { version: '10.0.0', build: 5062 },
      android: { version: '10.0.0', build: 2000000040 },
    })
  })

  it('exits 2 when HEAD has no committed native files', () => {
    const { app } = createRepo()

    rmSync(resolve(app.appDir, 'ios'), { recursive: true })
    app.commit('drop ios')

    expect(() => {
      return readGitState(isolatedExec, app.appDir, PATHS)
    }).toThrow(expect.objectContaining({ exitCode: 2 }))
  })
})

describe('fetchOrigin', () => {
  it('exits 2 when the fetch fails', () => {
    const { app } = createRepo()
    const log = vi.fn()

    git(app.root, 'remote', 'add', 'origin', resolve(app.root, 'missing-remote.git'))

    expect(() => {
      fetchOrigin(
        (file, args, options) => {
          return isolatedExec(file, args, { ...options, capture: true })
        },
        app.appDir,
        log,
      )
    }).toThrow(expect.objectContaining({ exitCode: 2, message: expect.stringContaining('git fetch origin failed') }))
    expect(log).toHaveBeenCalledWith('$ git fetch origin --quiet')
  })

  it('succeeds against a reachable origin', () => {
    const { app } = createRepo()
    const remote = resolve(app.root, 'origin.git')

    git(app.root, 'clone', '--quiet', '--bare', '.', remote)
    git(app.root, 'remote', 'add', 'origin', remote)

    expect(() => {
      fetchOrigin(isolatedExec, app.appDir, vi.fn())
    }).not.toThrow()
    expect(git(app.root, 'rev-parse', 'refs/remotes/origin/main')).toBe(git(app.root, 'rev-parse', 'HEAD'))
  })
})
