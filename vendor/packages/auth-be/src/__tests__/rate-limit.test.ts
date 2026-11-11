import { describe, expect, it } from 'vitest'

import { assertRateLimits, resolveRateLimits } from '../rate-limit.js'

const DEFAULTS = { perEmail: 5, perIp: 20, perIpVerify: 30, perIpRefresh: 60, windowSec: 3600, keyPrefix: 'magic' }

describe('resolveRateLimits', () => {
  it.each([
    ['no overrides', undefined, DEFAULTS],
    ['an empty object', {}, DEFAULTS],
    ['one override', { perIp: 3 }, { ...DEFAULTS, perIp: 3 }],
    ['a zero', { perEmail: 0 }, { ...DEFAULTS, perEmail: 0 }],
    ['a prefix', { keyPrefix: 'bo' }, { ...DEFAULTS, keyPrefix: 'bo' }],
  ])('%s', (_label, overrides, expected) => {
    expect(resolveRateLimits(overrides)).toEqual(expected)
  })

  it('keeps the default for an explicit undefined', () => {
    expect(resolveRateLimits({ windowSec: undefined } as unknown as { windowSec: number }).windowSec).toBe(3600)
  })
})

describe('assertRateLimits', () => {
  it.each(['perEmail', 'windowSec', 'keyPrefix'])('accepts a null %s, which resolves to the default', (name) => {
    const overrides = { [name]: null } as unknown as Record<string, number>

    expect(() => {
      assertRateLimits(overrides)
    }).not.toThrow()
    expect(resolveRateLimits(overrides)).toEqual(DEFAULTS)
  })
})
