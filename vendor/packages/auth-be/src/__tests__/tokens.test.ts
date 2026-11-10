import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'

import { AuthError } from '../errors.js'
import {
  assertSecret,
  generateRawToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../tokens.js'
import { ACCESS_SECRET, IDENTITY, REFRESH_SECRET } from './helpers/fakes.js'

describe('signed tokens', () => {
  it('carries the lifetime as ttlSec', () => {
    const access = signAccessToken({ sub: 'u1', roles: [], authMethod: 'magic' }, ACCESS_SECRET, IDENTITY, 60)
    const refresh = signRefreshToken({ sub: 'u1', jti: 'j1' }, REFRESH_SECRET, IDENTITY, 120)

    expect(access.ttlSec).toBe(60)
    expect(refresh.ttlSec).toBe(120)
    expect(access).not.toHaveProperty('expSec')
  })
})

describe('verifying tokens', () => {
  it('round-trips the access and refresh payloads', () => {
    const access = signAccessToken({ sub: 'u1', roles: ['admin'], authMethod: 'magic' }, ACCESS_SECRET, IDENTITY)
    const refresh = signRefreshToken({ sub: 'u1', jti: 'j1' }, REFRESH_SECRET, IDENTITY)

    expect(verifyAccessToken(access.token, ACCESS_SECRET, IDENTITY)).toEqual({
      sub: 'u1',
      roles: ['admin'],
      authMethod: 'magic',
    })
    expect(verifyRefreshToken(refresh.token, REFRESH_SECRET, IDENTITY)).toEqual({ sub: 'u1', jti: 'j1' })
  })

  it.each([
    [
      'another secret',
      () => {
        return signAccessToken({ sub: 'u1', roles: [], authMethod: 'magic' }, REFRESH_SECRET, IDENTITY).token
      },
    ],
    [
      'another audience',
      () => {
        return signAccessToken({ sub: 'u1', roles: [], authMethod: 'magic' }, ACCESS_SECRET, {
          ...IDENTITY,
          audience: 'other',
        }).token
      },
    ],
    [
      'an expired token',
      () => {
        return signAccessToken({ sub: 'u1', roles: [], authMethod: 'magic' }, ACCESS_SECRET, IDENTITY, -1).token
      },
    ],
    [
      'no subject',
      () => {
        return jwt.sign({ roles: [] }, ACCESS_SECRET, { algorithm: 'HS256', ...IDENTITY })
      },
    ],
    [
      'an empty subject',
      () => {
        return jwt.sign({ sub: '' }, ACCESS_SECRET, { algorithm: 'HS256', ...IDENTITY })
      },
    ],
    [
      'another algorithm',
      () => {
        return jwt.sign({ sub: 'u1' }, ACCESS_SECRET, { algorithm: 'HS512', ...IDENTITY })
      },
    ],
  ])('refuses %s with a 401 AuthError carrying the cause', (_label, mint) => {
    expect(() => {
      return verifyAccessToken(mint(), ACCESS_SECRET, IDENTITY)
    }).toThrow(expect.objectContaining({ code: 'INVALID_ACCESS_TOKEN', status: 401, cause: expect.any(Error) }))
  })

  it('throws the host error for a bad refresh token', () => {
    const createError = () => {
      return new Error('host')
    }

    expect(() => {
      return verifyRefreshToken('garbage', REFRESH_SECRET, IDENTITY, createError)
    }).toThrow('host')
    expect(() => {
      return verifyRefreshToken('garbage', REFRESH_SECRET, IDENTITY)
    }).toThrow(AuthError)
  })
})

describe('raw tokens and secrets', () => {
  it('generates 64 hex chars, never the same twice, and hashes them to sha-256 hex', () => {
    const raw = generateRawToken()

    expect(raw).toMatch(/^[a-f0-9]{64}$/)
    expect(generateRawToken()).not.toBe(raw)
    expect(hashToken(raw)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashToken(raw)).toBe(hashToken(raw))
  })

  it('refuses a missing or short secret by name', () => {
    expect(() => {
      return assertSecret('jwt.accessSecret', undefined)
    }).toThrow('auth: jwt.accessSecret must be at least 32 chars')
    expect(() => {
      return assertSecret('jwt.accessSecret', 'short')
    }).toThrow()
    expect(() => {
      return assertSecret('jwt.accessSecret', ACCESS_SECRET)
    }).not.toThrow()
  })
})
