import { describe, expect, it } from 'vitest'

import type { HistoryEntry, NativeStamps } from '../version.ts'
import { assertDeliveredLine, nextVersion } from '../version.ts'

type Kind = 'exact' | 'builds' | 'new-major' | 'single-platform'

interface Step {
  commit: string
  env: 'dev' | 'prod'
  kind: Kind
  ios: [string, number]
  android: [string, number]
}

const toStamps = ({ ios, android }: Pick<Step, 'ios' | 'android'>): NativeStamps => {
  return { ios: { version: ios[0], build: ios[1] }, android: { version: android[0], build: android[1] } }
}

// Plan §4.1: every version-changing commit, values read from each commit's native files.
const HULYO: { start: Pick<Step, 'ios' | 'android'>; steps: Step[] } = {
  start: { ios: ['6.0.0', 4002], android: ['6.0.0', 2000000012] },
  steps: [
    { commit: '502e2c82b', env: 'dev', kind: 'new-major', ios: ['7.9.9', 5003], android: ['7.9.9', 2000000013] },
    { commit: '7addc5a39', env: 'prod', kind: 'builds', ios: ['7.0.0', 5005], android: ['7.0.0', 2000000015] },
    { commit: '6db58cdb1', env: 'prod', kind: 'builds', ios: ['7.0.0', 5009], android: ['7.0.0', 2000000022] },
    { commit: '280619688', env: 'prod', kind: 'new-major', ios: ['8.0.0', 5015], android: ['8.0.0', 2000000026] },
    { commit: 'd60ba1681', env: 'dev', kind: 'single-platform', ios: ['8.9.9', 5020], android: ['8.0.0', 2000000026] },
    { commit: 'b2a9f1fa7', env: 'prod', kind: 'new-major', ios: ['9.0.0', 5050], android: ['9.0.0', 2000000028] },
    { commit: '977edf9cc', env: 'prod', kind: 'builds', ios: ['9.0.0', 5052], android: ['9.0.0', 2000000030] },
    { commit: 'f6b4e96cf', env: 'prod', kind: 'new-major', ios: ['10.0.0', 5054], android: ['10.0.0', 2000000032] },
    { commit: '2fdac7b2c', env: 'dev', kind: 'exact', ios: ['10.9.9', 5055], android: ['10.9.9', 2000000033] },
    { commit: '67068860e', env: 'dev', kind: 'exact', ios: ['10.9.10', 5056], android: ['10.9.10', 2000000034] },
    { commit: 'b5912a9cb', env: 'dev', kind: 'exact', ios: ['10.9.11', 5057], android: ['10.9.11', 2000000035] },
    { commit: 'f100bb6d3', env: 'dev', kind: 'exact', ios: ['10.9.12', 5058], android: ['10.9.12', 2000000036] },
    { commit: 'c16e52d63', env: 'prod', kind: 'exact', ios: ['10.0.0', 5059], android: ['10.0.0', 2000000037] },
    { commit: '7124f3377', env: 'prod', kind: 'exact', ios: ['10.0.0', 5060], android: ['10.0.0', 2000000038] },
    { commit: '9fbb97c24', env: 'dev', kind: 'exact', ios: ['10.9.13', 5061], android: ['10.9.13', 2000000039] },
    { commit: '370e0f0cb', env: 'prod', kind: 'exact', ios: ['10.0.0', 5062], android: ['10.0.0', 2000000040] },
  ],
}

const TRAVELIST: typeof HULYO = {
  start: { ios: ['4.0.0', 4004], android: ['4.0.0', 40004] },
  steps: [
    { commit: '8675c319b9', env: 'dev', kind: 'new-major', ios: ['5.9.9', 5008], android: ['5.9.9', 50008] },
    { commit: '07712223f7', env: 'dev', kind: 'new-major', ios: ['7.9.9', 5019], android: ['7.9.9', 50019] },
    { commit: '19c749f14c', env: 'dev', kind: 'new-major', ios: ['8.9.9', 5020], android: ['8.9.9', 50020] },
    { commit: 'de5cc5d8ab', env: 'prod', kind: 'builds', ios: ['8.0.0', 5023], android: ['8.0.0', 50023] },
    { commit: '0e1337c2a4', env: 'prod', kind: 'new-major', ios: ['9.0.0', 5035], android: ['9.0.0', 50035] },
    { commit: 'dba1772935', env: 'prod', kind: 'new-major', ios: ['10.0.0', 5037], android: ['10.0.0', 50037] },
    { commit: 'release tip', env: 'prod', kind: 'exact', ios: ['10.0.0', 5038], android: ['10.0.0', 50038] },
  ],
}

const replay = ({ start, steps }: typeof HULYO) => {
  const history: HistoryEntry[] = [{ source: 'start', ...toStamps(start) }]
  let head = toStamps(start)

  const results = steps.map((step) => {
    const actual = toStamps(step)
    const rule = nextVersion(step.env, head, history)
    const overridden = step.kind === 'new-major' ? nextVersion(step.env, head, history, step.ios[0]) : undefined

    history.push({ source: step.commit, ...actual })
    head = actual

    return { step, actual, rule, overridden }
  })

  return { history, head, results }
}

describe.each([
  ['hulyo', HULYO],
  ['travelist', TRAVELIST],
])('%s history replay', (_repo, sequence) => {
  const { results } = replay(sequence)

  it.each(
    results.map((result) => {
      return [result.step.commit, result.step.kind, result] as const
    }),
  )('%s (%s)', (_commit, kind, { actual, rule, overridden }) => {
    if (kind === 'exact') {
      expect(rule.version).toBe(actual.ios.version)
      expect(rule.ios.build).toBe(actual.ios.build)
      expect(rule.android.build).toBe(actual.android.build)
    }

    if (kind === 'builds') {
      expect(rule.version).toBe(actual.ios.version)
      expect(rule.ios.build).toBeLessThan(actual.ios.build)
      expect(rule.android.build).toBeLessThan(actual.android.build)
    }

    if (kind === 'new-major') {
      expect(rule.version).not.toBe(actual.ios.version)
      expect(overridden?.version).toBe(actual.ios.version)
      expect(overridden?.ios.build).toBeLessThanOrEqual(actual.ios.build)
      expect(overridden?.android.build).toBeLessThanOrEqual(actual.android.build)
    }

    if (kind === 'single-platform') {
      expect(rule.version).toBe(actual.ios.version)
      expect(rule.version).not.toBe(actual.android.version)
    }
  })
})

describe('next build after the replay', () => {
  it('hulyo: dev 10.9.14, plain prod refused, --version 10.0.0 / 11.0.0 accepted', () => {
    const { history, head } = replay(HULYO)
    const delivered = { state: 'found' as const, ref: 'origin/main', commit: '432b071dd', date: '2026-10-21', ...head }

    expect(nextVersion('dev', head, history)).toMatchObject({
      version: '10.9.14',
      ios: { build: 5063 },
      android: { build: 2000000041 },
    })
    expect(() => {
      assertDeliveredLine('prod', nextVersion('prod', head, history), undefined, delivered)
    }).toThrow(expect.objectContaining({ exitCode: 2 }))

    for (const version of ['10.0.0', '11.0.0']) {
      const derivation = nextVersion('prod', head, history, version)

      assertDeliveredLine('prod', derivation, version, delivered)
      expect(derivation).toMatchObject({ version, ios: { build: 5063 }, android: { build: 2000000041 } })
    }
  })

  it('travelist: dev 10.9.9 and prod 10.0.0, both 5039 / 50039, with 9.0.0 on main', () => {
    const { history, head } = replay(TRAVELIST)

    const delivered = {
      state: 'found' as const,
      ref: 'origin/main',
      commit: 'ce64ef6684',
      date: '2026-06-15',
      ...toStamps({ ios: ['9.0.0', 5035], android: ['9.0.0', 50035] }),
    }

    expect(nextVersion('dev', head, history)).toMatchObject({
      version: '10.9.9',
      ios: { build: 5039 },
      android: { build: 50039 },
    })

    const prod = nextVersion('prod', head, history)

    assertDeliveredLine('prod', prod, undefined, delivered)
    expect(prod).toMatchObject({ version: '10.0.0', ios: { build: 5039 }, android: { build: 50039 } })
  })
})
