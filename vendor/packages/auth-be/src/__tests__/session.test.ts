import { describe, expect, it } from 'vitest'

import { formatExpiry } from '../email.js'
import { hasUnsafeRedirectChars, sanitizeRedirectUrl } from '../http.js'
import { verifySession } from '../session.js'
import { signAccessToken, signRefreshToken } from '../tokens.js'
import { ACCESS_SECRET, IDENTITY, REFRESH_SECRET } from './helpers/fakes.js'

const token = signAccessToken({ sub: 'u1', roles: ['user'], authMethod: 'magic' }, ACCESS_SECRET, IDENTITY).token
const options = { ...IDENTITY, accessSecret: ACCESS_SECRET }

describe('verifySession', () => {
  it('returns the payload for a valid cookie or bearer token', () => {
    expect(verifySession({ cookie: `access_token=${token}` }, options)?.sub).toBe('u1')
    expect(verifySession({ Authorization: `Bearer ${token}` }, options)?.sub).toBe('u1')
  })

  it.each([
    ['no token', {}, options],
    ['a wrong audience', { cookie: `access_token=${token}` }, { ...options, audience: 'other' }],
    ['a missing secret', { cookie: `access_token=${token}` }, { ...IDENTITY, accessSecret: undefined }],
    ['a short secret', { cookie: `access_token=${token}` }, { ...IDENTITY, accessSecret: 'short' }],
    ['an empty bearer', { authorization: 'Bearer   ' }, options],
    ['a malformed cookie escape', { cookie: 'access_token=%E0%A4%A' }, options],
  ])('fails closed on %s', (_label, headers, opts) => {
    expect(verifySession(headers, opts)).toBeNull()
  })
})

describe('sanitizeRedirectUrl', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/trips?x=1', '/trips?x=1'],
    ['trips', '/trips'],
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/a\nb', '/'],
    [`/${'a'.repeat(2048)}`, '/'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeRedirectUrl(input)).toBe(expected)
  })
})

describe('formatExpiry', () => {
  it.each([
    [15, '15 minutes'],
    [1, '1 minute'],
    [60, '1 hour'],
    [120, '2 hours'],
    [72 * 60, '3 days'],
  ])('%i min → %s', (minutes, expected) => {
    expect(formatExpiry(minutes)).toBe(expected)
  })
})

describe('hasUnsafeRedirectChars', () => {
  it.each([
    ['/trips', false],
    ['/a?b=c#d', false],
    ['/\\evil.com', true],
    ['/a\u0000', true],
    ['/a\nb', true],
    ['/a\u007F', true],
  ])('%j → %s', (input, unsafe) => {
    expect(hasUnsafeRedirectChars(input)).toBe(unsafe)
  })
})

describe('signed tokens', () => {
  it('carries the lifetime as ttlSec', () => {
    const access = signAccessToken({ sub: 'u1', roles: [], authMethod: 'magic' }, ACCESS_SECRET, IDENTITY, 60)
    const refresh = signRefreshToken({ sub: 'u1', jti: 'j1' }, REFRESH_SECRET, IDENTITY, 120)

    expect(access.ttlSec).toBe(60)
    expect(refresh.ttlSec).toBe(120)
    expect(access).not.toHaveProperty('expSec')
  })
})
