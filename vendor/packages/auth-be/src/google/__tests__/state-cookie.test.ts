import jwt from 'jsonwebtoken'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_SECRET, IDENTITY, createFakes } from '../../__tests__/helpers/fakes.js'
import { createGoogleStub, googleConfig } from '../../__tests__/helpers/google-stub.js'
import { createMagicLinkAuth } from '../../create-auth.js'
import { signAccessToken } from '../../tokens.js'
import { createStateKey, signState, verifyState } from '../state-cookie.js'

const STATE = { s: 'state', n: 'nonce', v: 'verifier', r: '/trips' }

afterEach(() => {
  vi.useRealTimers()
})

describe('state cookie', () => {
  it('a state signed with the access secret itself is refused', () => {
    const key = createStateKey(ACCESS_SECRET)
    const withAccessSecret = jwt.sign({ ...STATE, typ: 'google-state' }, ACCESS_SECRET, IDENTITY)
    const accessToken = signAccessToken({ sub: 'u1', roles: [], authMethod: 'google' }, ACCESS_SECRET, IDENTITY).token

    expect(verifyState(key, signState(key, STATE, IDENTITY), IDENTITY)).toEqual({ ok: true, state: STATE })
    expect(verifyState(key, withAccessSecret, IDENTITY)).toEqual({ ok: false, step: 'bad-signature' })
    expect(verifyState(key, accessToken, IDENTITY)).toEqual({ ok: false, step: 'bad-signature' })
  })

  it('refuses a state of another typ, shape or engine identity', () => {
    const key = createStateKey(ACCESS_SECRET)

    const signed = (payload: object) => {
      return jwt.sign(payload, key, IDENTITY)
    }

    for (const token of [
      signed({ ...STATE, typ: 'access' }),
      signed({ ...STATE, typ: 'google-state', v: 42 }),
      signed({ s: 'state', typ: 'google-state' }),
      signState(key, STATE, { issuer: 'other-api', audience: IDENTITY.audience }),
      signState(createStateKey('o'.repeat(32)), STATE, IDENTITY),
    ]) {
      expect(verifyState(key, token, IDENTITY)).toEqual({ ok: false, step: 'bad-signature' })
    }
  })

  it('reads an authentic state past 600 s as expired', () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const key = createStateKey(ACCESS_SECRET)
    const token = signState(key, STATE, IDENTITY)

    vi.setSystemTime(Date.now() + 599 * 1000)
    expect(verifyState(key, token, IDENTITY).ok).toBe(true)

    vi.setSystemTime(Date.now() + 2 * 1000)
    expect(verifyState(key, token, IDENTITY)).toEqual({ ok: false, step: 'expired' })
  })

  it('the cookie is __Secure-google_oauth, HttpOnly, Secure, SameSite=Lax, scoped to the callback path, Max-Age 600', () => {
    const stub = createGoogleStub()

    for (const [redirectUri, path] of [
      ['https://app.test/api/v1/auth/google/callback', '/api/v1/auth/google/callback'],
      ['https://app.test/auth/google/callback?from=console', '/auth/google/callback'],
    ] as const) {
      const auth = createMagicLinkAuth({ ...createFakes().config, google: googleConfig(stub, { redirectUri }) })
      const { stateCookie } = auth.google!.start({ redirectUrl: '/trips' })

      expect(stateCookie).toMatch(
        new RegExp(
          `^__Secure-google_oauth=[\\w-]+\\.[\\w-]+\\.[\\w-]+; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=600$`,
        ),
      )
      expect(auth.google!.clearStateCookie()).toBe(
        `__Secure-google_oauth=; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=0`,
      )
    }
  })
})
