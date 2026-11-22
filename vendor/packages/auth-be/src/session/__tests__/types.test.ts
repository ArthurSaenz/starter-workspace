/* eslint-disable sonarjs/no-hardcoded-ip -- fixture client IPs */
import { describe, expect, it } from 'vitest'

import type { AuthErrorCode } from '../../errors.js'
import { withMeta } from '../types.js'

describe('authErrorCode', () => {
  it('stays closed at exactly ten codes', () => {
    // A key added to or dropped from the union fails to compile here.
    const codes: Record<AuthErrorCode, true> = {
      INVALID_ACCESS_TOKEN: true,
      INVALID_REFRESH_TOKEN: true,
      INVALID_OR_EXPIRED_TOKEN: true,
      INVALID_REQUEST: true,
      UNAUTHENTICATED: true,
      USER_NOT_FOUND: true,
      NOT_INVITED: true,
      RATE_LIMITED: true,
      NOT_FOUND: true,
      FORBIDDEN: true,
    }

    expect(Object.keys(codes)).toHaveLength(10)
  })
})

describe('withMeta', () => {
  it.each([
    [undefined, {}],
    [{}, {}],
    [{ ipAddress: null, userAgent: null }, {}],
    [{ ipAddress: '', userAgent: '' }, {}],
    [{ ipAddress: '1.2.3.4' }, { ipAddress: '1.2.3.4' }],
    [{ userAgent: 'vitest' }, { userAgent: 'vitest' }],
    [
      { ipAddress: '1.2.3.4', userAgent: 'vitest' },
      { ipAddress: '1.2.3.4', userAgent: 'vitest' },
    ],
  ])('%j → %j', (meta, expected) => {
    expect(withMeta(meta)).toEqual(expected)
  })
})
