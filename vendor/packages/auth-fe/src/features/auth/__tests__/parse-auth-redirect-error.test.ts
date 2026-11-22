import { describe, expect, it } from 'vitest'

import { parseAuthRedirectError } from '../services/libs.js'
import type { AuthRedirectError } from '../types.js'

// Mirrors the backend's closed list; the Record fails to compile if a reason is added or dropped.
const REASONS: Record<AuthRedirectError, true> = {
  cancelled: true,
  invalid_state: true,
  not_allowed: true,
  rate_limited: true,
  failed: true,
}

describe('authRedirectError', () => {
  it('has exactly five reasons', () => {
    expect(Object.keys(REASONS)).toHaveLength(5)
  })
})

describe('parseAuthRedirectError', () => {
  it.each([
    ['cancelled', 'cancelled'],
    ['invalid_state', 'invalid_state'],
    ['not_allowed', 'not_allowed'],
    ['rate_limited', 'rate_limited'],
    ['failed', 'failed'],
    ['', null],
    ['CANCELLED', null],
    [' cancelled', null],
    ['toString', null],
    ['__proto__', null],
    [null, null],
    [undefined, null],
    [42, null],
  ])('accepts the five reasons and nothing else: %j -> %j', (input, expected) => {
    expect(parseAuthRedirectError(input)).toBe(expected)
  })
})
