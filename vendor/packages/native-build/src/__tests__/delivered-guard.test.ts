import { describe, expect, it } from 'vitest'

import type { Delivered } from '../version.ts'
import { assertNotDelivered, nextVersion } from '../version.ts'

const HEAD = { ios: { version: '10.0.0', build: 5062 }, android: { version: '10.0.0', build: 2000000040 } }

const HISTORY = [
  {
    source: 'dev (9fbb97c24)',
    ios: { version: '10.9.13', build: 5061 },
    android: { version: '10.9.13', build: 2000000039 },
  },
]

const deliveredAt = (version: string): Delivered => {
  return {
    ref: 'origin/main',
    commit: '432b071dd',
    date: '2026-10-21',
    ios: { version, build: 5062 },
    android: { version, build: 2000000040 },
  }
}

const attempt = (env: 'dev' | 'prod', delivered: Delivered | undefined, override?: string) => {
  const derivation = nextVersion(env, HEAD, HISTORY, override)

  assertNotDelivered(env, derivation, override !== undefined, delivered)

  return derivation
}

describe('delivered-version guard', () => {
  describe('hEAD 10.0.0 with 10.0.0 delivered on origin/main', () => {
    const delivered = deliveredAt('10.0.0')

    it('refuses plain prod with exit 2, naming the main commit, its date and both ways forward', () => {
      expect(() => {
        return attempt('prod', delivered)
      }).toThrow(
        expect.objectContaining({
          exitCode: 2,
          message: [
            'prod 10.0.0 is already delivered on origin/main (432b071dd, 2026-10-21).',
            'Start the next major:   pnpm run build-native-prod --version 11.0.0',
            'Rebuild 10.0.0 anyway:  pnpm run build-native-prod --version 10.0.0',
            'next major: pnpm run build-native-prod --version 11.0.0',
          ].join('\n'),
        }),
      )
    })

    it('fires when only one platform carries the delivered version', () => {
      expect(() => {
        return attempt('prod', { ...delivered, ios: { version: '9.0.0', build: 1 } })
      }).toThrow(expect.objectContaining({ exitCode: 2 }))
    })

    it('lets --version 10.0.0 rebuild with new build numbers', () => {
      expect(attempt('prod', delivered, '10.0.0')).toMatchObject({
        version: '10.0.0',
        ios: { build: 5063 },
        android: { build: 2000000041 },
      })
    })

    it('lets --version 11.0.0 start the next major', () => {
      expect(attempt('prod', delivered, '11.0.0').version).toBe('11.0.0')
    })

    it('does not guard dev', () => {
      expect(attempt('dev', delivered).version).toBe('10.9.14')
    })
  })

  it('lets plain prod through when main is on an older version (travelist)', () => {
    expect(attempt('prod', deliveredAt('9.0.0')).version).toBe('10.0.0')
  })

  it('lets plain prod through when main has no native files', () => {
    expect(
      attempt('prod', { ref: 'origin/main', commit: '', date: '', android: undefined, ios: undefined }).version,
    ).toBe('10.0.0')
  })

  describe('without origin/main', () => {
    it('fails closed on plain prod, with both commands', () => {
      expect(() => {
        return attempt('prod', undefined)
      }).toThrow(
        expect.objectContaining({
          exitCode: 2,
          message: expect.stringMatching(
            /^cannot verify the delivered version: no origin\/main\n.*--version 11\.0\.0\n.*--version 10\.0\.0\nnext major: /,
          ),
        }),
      )
    })

    it('accepts --version 10.0.0', () => {
      expect(attempt('prod', undefined, '10.0.0').version).toBe('10.0.0')
    })

    it('does not guard dev', () => {
      expect(attempt('dev', undefined).version).toBe('10.9.14')
    })
  })
})
