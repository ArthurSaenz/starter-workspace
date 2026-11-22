import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractAccessToken, verifyCustomerSession } from '../lambda/customerSession.js'
import { TEST_SESSION } from './helpers/handler-options.js'
import { TEST_CUSTOMER_ID, TEST_JWT_SECRET, sessionCookie, signAccessToken } from './helpers/session.js'

describe('extractAccessToken', () => {
  it('reads the access_token cookie regardless of header casing and cookie order', () => {
    expect(extractAccessToken({ Cookie: 'refresh_token=r; access_token=abc; other=1' })).toBe('abc')
    expect(extractAccessToken({ cookie: 'access_token=abc' })).toBe('abc')
  })

  it('falls back to a bearer Authorization header', () => {
    expect(extractAccessToken({ authorization: 'Bearer xyz' })).toBe('xyz')
    expect(extractAccessToken({ Authorization: 'Bearer   ' })).toBeUndefined()
  })

  it('treats a malformed percent-escape in the cookie as no token instead of throwing', () => {
    expect(extractAccessToken({ cookie: 'access_token=%E0%A4%A' })).toBeUndefined()
  })

  it('returns undefined with no headers, no cookie and no bearer', () => {
    expect(extractAccessToken(undefined)).toBeUndefined()
    expect(extractAccessToken({ cookie: 'other=1' })).toBeUndefined()
    expect(extractAccessToken({ authorization: 'Basic abc' })).toBeUndefined()
  })
})

describe('verifyCustomerSession', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the customer id for a token signed by client-api', () => {
    expect(verifyCustomerSession({ cookie: sessionCookie() }, TEST_SESSION)).toEqual({ customerId: TEST_CUSTOMER_ID })
  })

  it('fails CLOSED when no secret is configured, even for a well-formed token', () => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', '')

    expect(verifyCustomerSession({ cookie: sessionCookie() }, TEST_SESSION)).toBeNull()
  })

  it('fails CLOSED on a secret shorter than client-api would ever mint with', () => {
    const short = 'x'.repeat(31)

    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', short)

    expect(
      verifyCustomerSession({ cookie: sessionCookie(signAccessToken({ secret: short })) }, TEST_SESSION),
    ).toBeNull()
  })

  it('rejects a token signed with another secret', () => {
    expect(
      verifyCustomerSession({ cookie: sessionCookie(signAccessToken({ secret: 'x'.repeat(40) })) }, TEST_SESSION),
    ).toBeNull()
  })

  it('rejects an expired token', () => {
    expect(
      verifyCustomerSession({ cookie: sessionCookie(signAccessToken({ expiresIn: '-1s' })) }, TEST_SESSION),
    ).toBeNull()
  })

  it('rejects a token minted for another issuer or audience', () => {
    expect(
      verifyCustomerSession({ cookie: sessionCookie(signAccessToken({ issuer: 'someone-else' })) }, TEST_SESSION),
    ).toBeNull()
    expect(
      verifyCustomerSession({ cookie: sessionCookie(signAccessToken({ audience: 'backoffice' })) }, TEST_SESSION),
    ).toBeNull()
  })

  it('rejects a token without a subject', () => {
    expect(verifyCustomerSession({ cookie: sessionCookie(signAccessToken({ sub: '' })) }, TEST_SESSION)).toBeNull()
  })

  it('returns null when the request carries no token at all', () => {
    expect(verifyCustomerSession({}, TEST_SESSION)).toBeNull()
    expect(verifyCustomerSession(undefined, TEST_SESSION)).toBeNull()
  })
})
