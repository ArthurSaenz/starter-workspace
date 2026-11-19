import { describe, expect, it } from 'vitest'

import type { Delivered, HistoryEntry, NativeStamps } from '../version.ts'
import { assertDeliveredLine, compareVersions, nextVersion } from '../version.ts'

const stamps = (version: string, ios: number, android: number, androidVersion = version): NativeStamps => {
  return { ios: { version, build: ios }, android: { version: androidVersion, build: android } }
}

const HEAD_10 = stamps('10.0.0', 5062, 2000000040)
const HEAD_9 = stamps('9.0.0', 5035, 50035)
const DEV_HISTORY: HistoryEntry[] = [{ source: 'dev (9fbb97c24)', ...stamps('10.9.13', 5061, 2000000039) }]

const deliveredAt = (version: string, androidVersion = version): Delivered => {
  return {
    state: 'found',
    ref: 'origin/main',
    commit: '432b071dd',
    date: '2026-10-21',
    ...stamps(version, 5062, 2000000040, androidVersion),
  }
}

const attempt = (
  env: 'dev' | 'prod',
  delivered: Delivered,
  {
    head = HEAD_10,
    history = DEV_HISTORY,
    override,
  }: { head?: NativeStamps; history?: HistoryEntry[]; override?: string } = {},
) => {
  const derivation = nextVersion(env, head, history, override)

  assertDeliveredLine(env, derivation, override, delivered)

  return derivation
}

const refusal = (run: () => unknown): Error & { exitCode: number } => {
  try {
    run()
  } catch (error) {
    return error as Error & { exitCode: number }
  }

  throw new Error('expected a refusal')
}

describe('compareVersions', () => {
  it.each([
    ['9.0.0', '10.0.0', -1],
    ['10.0.0', '9.0.0', 1],
    ['10.0.0', '10.0.0', 0],
    ['10.9.9', '10.9.10', -1],
    ['10.0.0', '10.9.13', -1],
  ])('%s vs %s compares numerically', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b) ?? Number.NaN)).toBe(sign)
  })

  it('is undefined for a value that is not x.y.z', () => {
    expect(compareVersions('10.0.0', '10.0')).toBeUndefined()
  })
})

describe('delivered-version guard', () => {
  describe('hEAD 10.0.0 with 10.0.0 delivered on origin/main', () => {
    const delivered = deliveredAt('10.0.0')

    it('refuses plain prod with exit 2, naming the main commit, its date and both ways forward once', () => {
      const error = refusal(() => {
        return attempt('prod', delivered)
      })

      expect(error.exitCode).toBe(2)
      expect(error.message).toBe(
        [
          'prod 10.0.0 is already delivered on origin/main (432b071dd, 2026-10-21).',
          'Start the next major:   pnpm run build-native-prod --version 11.0.0',
          'Rebuild 10.0.0 anyway:  pnpm run build-native-prod --version 10.0.0',
        ].join('\n'),
      )
    })

    it('fires when only one platform carries the delivered version', () => {
      expect(
        refusal(() => {
          return attempt('prod', deliveredAt('10.0.0', '9.0.0'))
        }).exitCode,
      ).toBe(2)
    })

    it('lets --version 10.0.0 rebuild with new build numbers', () => {
      expect(attempt('prod', delivered, { override: '10.0.0' })).toMatchObject({
        version: '10.0.0',
        ios: { build: 5063 },
        android: { build: 2000000041 },
      })
    })

    it('lets --version 11.0.0 start the next major', () => {
      expect(attempt('prod', delivered, { override: '11.0.0' }).version).toBe('11.0.0')
    })

    it('leaves plain dev unchanged: the next N.9.p', () => {
      expect(attempt('dev', delivered).version).toBe('10.9.14')
    })
  })

  describe('a branch behind the delivered major (HEAD 9.0.0, origin/main 10.0.0)', () => {
    const delivered = deliveredAt('10.0.0')

    it.each(['dev', 'prod'] as const)('refuses plain %s with exit 2 and tells the human to merge first', (env) => {
      const error = refusal(() => {
        return attempt(env, delivered, { head: HEAD_9, history: [] })
      })

      expect(error.exitCode).toBe(2)
      expect(error.message).toBe(
        'this branch is behind the delivered version: HEAD is at major 9, origin/main (432b071dd, 2026-10-21) holds 10.0.0.\n' +
          'Merge the integration branch into this branch first, or pass --version.',
      )
    })

    it('fires when only one platform on main is on the higher major', () => {
      expect(
        refusal(() => {
          return attempt('dev', deliveredAt('9.0.0', '10.0.0'), { head: HEAD_9, history: [] })
        }).exitCode,
      ).toBe(2)
    })

    it('refuses a --version whose major is below the delivered major', () => {
      const error = refusal(() => {
        return attempt('prod', delivered, { head: HEAD_9, history: [], override: '9.5.0' })
      })

      expect(error.exitCode).toBe(2)
      expect(error.message).toContain('--version 9.5.0 is below the delivered major 10 on origin/main')
    })

    it.each(['10.0.0', '11.0.0', '10.9.9'])('accepts --version %s at or above the delivered major', (override) => {
      expect(attempt('prod', delivered, { head: HEAD_9, history: [], override }).version).toBe(override)
    })
  })

  it('refuses plain prod below the delivered version within the same major', () => {
    const error = refusal(() => {
      return attempt('prod', deliveredAt('10.9.13'))
    })

    expect(error.exitCode).toBe(2)
    expect(error.message).toMatch(/^prod 10\.0\.0 is below the delivered 10\.9\.13 on origin\/main/)
  })

  it('refuses plain prod when the delivered version cannot be compared', () => {
    expect(
      refusal(() => {
        return attempt('prod', deliveredAt('10.0'))
      }).message,
    ).toContain('cannot compare prod 10.0.0 with "10.0"')
  })

  it('leaves dev and prod unchanged when main is on an older version (travelist after #1020)', () => {
    const delivered = deliveredAt('9.0.0')

    expect(attempt('dev', delivered).version).toBe('10.9.14')
    expect(attempt('prod', delivered).version).toBe('10.0.0')
  })

  describe('an undelivered higher major on another branch (HEAD and main at 9.0.0, a 10.0.0 release branch)', () => {
    const delivered = deliveredAt('9.0.0')
    const history: HistoryEntry[] = [{ source: 'origin/release/x (aaa)', ...stamps('10.0.0', 5038, 50038) }]

    it('keeps deriving 9.9.x for dev', () => {
      expect(attempt('dev', delivered, { head: HEAD_9, history })).toMatchObject({
        version: '9.9.9',
        ios: { build: 5039 },
        android: { build: 50039 },
      })
    })

    it('refuses plain prod only by the equality rule', () => {
      expect(
        refusal(() => {
          return attempt('prod', delivered, { head: HEAD_9, history })
        }).message,
      ).toMatch(/^prod 9\.0\.0 is already delivered on origin\/main/)
    })
  })

  describe('without origin/main', () => {
    const delivered: Delivered = { state: 'no-ref', ref: 'origin/main' }

    it('fails closed on plain prod, with both commands', () => {
      const error = refusal(() => {
        return attempt('prod', delivered)
      })

      expect(error.exitCode).toBe(2)
      expect(error.message).toMatch(
        /^cannot verify the delivered version: no origin\/main\n.*--version 11\.0\.0\n.*--version 10\.0\.0$/,
      )
    })

    it('accepts --version 10.0.0', () => {
      expect(attempt('prod', delivered, { override: '10.0.0' }).version).toBe('10.0.0')
    })

    it('does not guard dev', () => {
      expect(attempt('dev', delivered).version).toBe('10.9.14')
    })
  })

  describe('with origin/main lacking the native files', () => {
    const delivered: Delivered = { state: 'no-files', ref: 'origin/main', path: 'apps/mobile/android/app/build.gradle' }

    it('fails closed on plain prod, naming the path, with both commands', () => {
      const error = refusal(() => {
        return attempt('prod', delivered)
      })

      expect(error.exitCode).toBe(2)
      expect(error.message).toMatch(
        /origin\/main has no native files at apps\/mobile\/android\/app\/build\.gradle\n.*--version 11\.0\.0\n.*--version 10\.0\.0$/,
      )
    })

    it('accepts --version and leaves dev alone', () => {
      expect(attempt('prod', delivered, { override: '10.0.0' }).version).toBe('10.0.0')
      expect(attempt('dev', delivered).version).toBe('10.9.14')
    })
  })
})
