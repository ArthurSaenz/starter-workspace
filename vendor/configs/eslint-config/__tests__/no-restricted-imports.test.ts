import { beforeAll, describe, expect, it } from 'vitest'

import config from '../index.js'
import { makeLintIndex } from './_lint-fixtures.js'

// Fixture tree exercising the path-based `no-restricted-imports` rule (Phase 1): a deep import
// into a feature/service is flagged; its barrel and relative intra-element imports pass. The
// lint-and-index harness lives in ./_lint-fixtures.ts, shared with boundaries.test.ts so the
// two suites cannot drift apart.
const { populate, expectFlagged, expectClean } = makeLintIndex({
  fixtures: '__tests__/fixtures/src',
  ruleFilter: (id) => id === 'no-restricted-imports',
  flagRuleId: 'no-restricted-imports',
})

beforeAll(populate)

describe('no-restricted-imports: feature public-API boundary', () => {
  it('flags a deep feature import at depth 1 (#root/features/alpha/util)', () => {
    expectFlagged('features/beta/bad-deep-1.ts', "feature's public API")
  })

  it('flags a deep feature import at depth 2 (#root/features/alpha/components/Widget)', () => {
    // The previous `*/features/*/*` glob missed depth >= 2 — this guards the regression.
    expectFlagged('features/beta/bad-deep-2.ts', "feature's public API")
  })

  it('allows importing a feature through its barrel (#root/features/alpha)', () => {
    expectClean('features/beta/ok-barrel.ts')
  })

  it('allows a relative intra-feature import (./local)', () => {
    expectClean('features/beta/relative-ok.ts')
  })

  // The explicit barrel (#root/features/alpha/index[.js]) IS the public API — and the only valid
  // form under NodeNext/ESM. The `!**/features/*/index*` carve-outs allow it. This pairs with the
  // service barrel test below to guard that both negation groups stay in sync.
  it('allows the explicit feature barrel with extension (#root/features/alpha/index.js)', () => {
    expectClean('features/beta/ok-barrel-index-ext.ts')
  })

  it('allows the explicit feature barrel without extension (#root/features/alpha/index)', () => {
    expectClean('features/beta/ok-barrel-index-noext.ts')
  })
})

describe('no-restricted-imports: service public-API boundary', () => {
  it('flags a deep service import (#root/services/email/client)', () => {
    expectFlagged('services/sms/bad-deep.ts', "service's public API")
  })

  it('allows importing a service through its barrel (#root/services/email)', () => {
    expectClean('services/sms/ok-barrel.ts')
  })

  // Pairs with the feature barrel tests to guard the two negation groups stay in sync.
  it('allows the explicit service barrel with extension (#root/services/email/index.js)', () => {
    expectClean('services/sms/ok-barrel-index-ext.ts')
  })

  // Pins the exact reported false-positive shape: a RELATIVE explicit-index specifier.
  it('allows a relative explicit service barrel (../email/index.js)', () => {
    expectClean('services/sms/ok-barrel-relative-index.ts')
  })

  // Regression: only the IMMEDIATE barrel is exempt — a nested `internal/index.js` stays flagged.
  it('flags a deep service import that ends in a nested index (#root/services/email/internal/index.js)', () => {
    expectFlagged('services/sms/bad-deep-internal-index.ts', "service's public API")
  })
})

describe('no-restricted-imports: config integrity', () => {
  it('resolves to a non-empty flat config array', async () => {
    const flat = await config()

    expect(Array.isArray(flat)).toBe(true)
    expect(flat.length).toBeGreaterThan(0)
  })
})
