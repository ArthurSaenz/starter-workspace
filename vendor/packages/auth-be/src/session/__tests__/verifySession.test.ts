import { describe, expect, it } from 'vitest'

import { ACCESS_SECRET, IDENTITY } from '../../__tests__/helpers/fakes.js'
import { signAccessToken } from '../../tokens.js'
import { verifySession } from '../verifySession.js'

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
