import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { TestUser } from '../../__tests__/helpers/fakes.js'
import { createFakes, invitedUser } from '../../__tests__/helpers/fakes.js'
import {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  createGoogleStub,
  googleConfig,
} from '../../__tests__/helpers/google-stub.js'
import type { MagicLinkAuth } from '../../create-auth.js'
import { createMagicLinkAuth } from '../../create-auth.js'
import type { GoogleFailureStep, GoogleSignInConfig, GoogleSignInError } from '../config.js'
import type { GoogleSignIn } from '../google-sign-in.js'

type Auth = MagicLinkAuth<TestUser, { id: string; email: string }, object>

const build = (google: Partial<GoogleSignInConfig<TestUser, object>>, baseUrl = 'https://app.test') => {
  const fakes = createFakes([invitedUser()])

  return createMagicLinkAuth({
    ...fakes.config,
    magicLink: { baseUrl },
    google: googleConfig(createGoogleStub(), google),
  })
}

describe('assertGoogleConfig', () => {
  it.each([
    ['an empty clientId', { clientId: '' }, /clientId/],
    ['an empty clientSecret', { clientSecret: '' }, /clientSecret/],
    ['a relative redirectUri', { redirectUri: '/api/v1/auth/google/callback' }, /absolute/],
    ['a redirectUri with a fragment', { redirectUri: 'https://app.test/api/v1/auth/google/callback#x' }, /fragment/],
    ['a redirectUri with an empty fragment', { redirectUri: 'https://app.test/callback#' }, /fragment/],
    ['http on a non-localhost host', { redirectUri: 'http://app.test/api/v1/auth/google/callback' }, /https/],
    ['a non-http scheme', { redirectUri: 'ftp://app.test/callback' }, /https/],
    [
      'redirectUri on another origin than magicLink.baseUrl',
      { redirectUri: 'https://api.app.test/callback' },
      /origin/,
    ],
    ['redirectUri on another port than magicLink.baseUrl', { redirectUri: 'https://app.test:8443/callback' }, /origin/],
    ['a protocol-relative errorPath', { errorPath: '//evil.com' }, /errorPath/],
    ['an errorPath without a leading slash', { errorPath: 'auth/sign-in' }, /errorPath/],
    ['an absolute errorPath', { errorPath: 'https://evil.com/sign-in' }, /errorPath/],
    ['an errorPath with a query', { errorPath: '/sign-in?x=1' }, /errorPath must not carry a query or fragment/],
    ['an errorPath with a fragment', { errorPath: '/sign-in#top' }, /errorPath must not carry a query or fragment/],
    ['an empty hostedDomains list', { hostedDomains: [] }, /hostedDomains/],
    ['an empty hosted domain', { hostedDomains: ['example.com', ''] }, /hostedDomains/],
    ['hostedDomains as a string', { hostedDomains: 'example.com' as unknown as string[] }, /hostedDomains/],
  ])('refuses %s', (_label, google, message) => {
    expect(() => {
      return build(google)
    }).toThrow(message)
  })

  it.each([
    ['https on the SPA origin', 'https://app.test', 'https://app.test/api/v1/auth/google/callback'],
    ['http on localhost', 'http://localhost:5173', 'http://localhost:5173/api/v1/auth/google/callback'],
    ['http on 127.0.0.1', 'http://127.0.0.1:3000', 'http://127.0.0.1:3000/callback'],
    ['http on a *.localhost name', 'http://app.localhost', 'http://app.localhost/callback'],
    ['a baseUrl with a trailing slash', 'https://app.test/', 'https://app.test/callback'],
  ])('accepts %s', (_label, baseUrl, redirectUri) => {
    expect(build({ redirectUri, errorPath: '/sign-in', hostedDomains: ['example.com'] }, baseUrl).google).toBeDefined()
  })
})

describe('google.fetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to the global fetch', async () => {
    const stub = createGoogleStub()
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(stub.fetch)
    const google = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI }
    const auth = createMagicLinkAuth({ ...createFakes([invitedUser()]).config, google })
    const started = auth.google!.start({ redirectUrl: undefined })

    const result = await auth.google!.complete({
      query: {
        code: stub.authorize(started.location),
        state: new URL(started.location).searchParams.get('state')!,
        error: undefined,
      },
      headers: { cookie: started.stateCookie.split(';')[0]! },
    })

    expect(result.ok).toBe(true)
    expect(globalFetch).toHaveBeenCalledTimes(2)
  })
})

describe('google sign-in shape', () => {
  it('googleSignInError has exactly five reasons', () => {
    const reasons: Record<GoogleSignInError, true> = {
      cancelled: true,
      invalid_state: true,
      not_allowed: true,
      rate_limited: true,
      failed: true,
    }

    expect(Object.keys(reasons)).toHaveLength(5)
  })

  it('googleFailureStep is the closed list of thirteen steps', () => {
    const steps: Record<GoogleFailureStep, true> = {
      'missing-cookie': true,
      'bad-signature': true,
      expired: true,
      mismatch: true,
      'provider-error': true,
      'rate-limit': true,
      'token-exchange': true,
      jwks: true,
      'id-token': true,
      email: true,
      'hosted-domain': true,
      user: true,
      store: true,
    }

    expect(Object.keys(steps)).toHaveLength(13)
  })

  it('googleSignIn exposes exactly start, complete, clearStateCookie and failureLocation', () => {
    const keys: Record<keyof GoogleSignIn<object>, true> = {
      start: true,
      complete: true,
      clearStateCookie: true,
      failureLocation: true,
    }

    expect(Object.keys(keys)).toHaveLength(4)
    expect(Object.keys(build({}).google!).sort()).toEqual(Object.keys(keys).sort())
  })

  it('failureLocation matches the location of a complete() failure without a redirect', async () => {
    const fakes = createFakes([invitedUser()])
    const stub = createGoogleStub()

    const auth = createMagicLinkAuth({
      ...fakes.config,
      magicLink: { baseUrl: 'https://app.test/' },
      google: googleConfig(stub),
    })

    const google = auth.google!

    const complete = async (query: { code?: string; error?: string }) => {
      const started = google.start({ redirectUrl: undefined })
      const params = new URL(started.location).searchParams

      return google.complete({
        query: {
          code: query.code ?? stub.authorize(started.location),
          state: params.get('state')!,
          error: query.error,
        },
        headers: { cookie: started.stateCookie.split(';')[0]! },
      })
    }

    const failures: Record<GoogleSignInError, () => ReturnType<typeof google.complete>> = {
      invalid_state: () => {
        return google.complete({ query: { code: 'c', state: 's', error: undefined }, headers: {} })
      },
      cancelled: () => {
        return complete({ error: 'access_denied' })
      },
      failed: () => {
        return complete({ error: 'server_error' })
      },
      not_allowed: () => {
        fakes.users.clear()

        return complete({})
      },
      rate_limited: () => {
        fakes.rateLimiter.limitOverride = 0

        return complete({})
      },
    }

    for (const [reason, run] of Object.entries(failures) as [
      GoogleSignInError,
      () => Promise<{ location: string }>,
    ][]) {
      const location = google.failureLocation(reason)

      expect(location).toBe(`https://app.test/auth/sign-in?auth_error=${reason}`)
      expect((await run()).location).toBe(location)
    }
  })
})

describe('google on the engine type', () => {
  it("'google' is an optional key of MagicLinkAuth", () => {
    expectTypeOf<Auth>().toHaveProperty('google')
    expectTypeOf<Auth['google']>().toEqualTypeOf<GoogleSignIn<object> | undefined>()
    expectTypeOf<Pick<Auth, 'google'>>().toEqualTypeOf<{ google?: GoogleSignIn<object> }>()
  })

  it('createMagicLinkAuth without google has no google key', () => {
    const auth = createMagicLinkAuth(createFakes().config)

    expect('google' in auth).toBe(false)
    expect(Object.keys(auth)).not.toContain('google')
  })
})
