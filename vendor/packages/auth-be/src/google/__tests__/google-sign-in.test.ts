/* eslint-disable sonarjs/assertions-in-tests -- `expectFailure` asserts, and the rule does not follow helpers */
import jwt from 'jsonwebtoken'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TestUser } from '../../__tests__/helpers/fakes.js'
import { ACCESS_SECRET, IDENTITY, createFakes, invitedUser } from '../../__tests__/helpers/fakes.js'
import type { SignOptions } from '../../__tests__/helpers/google-stub.js'
import {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  createGoogleStub,
  googleConfig,
} from '../../__tests__/helpers/google-stub.js'
import type { MagicLinkAuthConfig } from '../../auth-config.js'
import { createMagicLinkAuth } from '../../create-auth.js'
import type { GoogleFailureStep, GoogleSignInConfig, GoogleSignInError } from '../config.js'
import type { GoogleCallbackInput } from '../google-sign-in.js'
import { pkceChallenge } from '../pkce.js'

type Config = MagicLinkAuthConfig<TestUser, { id: string; email: string }, object>
type Level = 'info' | 'warn' | 'error'

const IP = '203.0.113.7'
const SUB = '110169484474386276334'
const ERROR_PAGE = 'https://app.test/auth/sign-in'

interface CallbackOptions {
  redirectUrl?: string
  claims?: Record<string, unknown>
  sign?: SignOptions
  query?: Partial<GoogleCallbackInput['query']>
  cookie?: string
  /** Replaces the token endpoint's ID token with one built from the start URL's nonce. */
  forge?: (nonce: string) => string
  /** Time that passes between start and callback. */
  elapseMs?: number
}

const setup = ({
  google = {},
  config = {},
  seed = [invitedUser()],
}: { google?: Partial<GoogleSignInConfig<TestUser, object>>; config?: Partial<Config>; seed?: TestUser[] } = {}) => {
  const fakes = createFakes(seed)
  const stub = createGoogleStub()
  const auth = createMagicLinkAuth({ ...fakes.config, ...config, google: googleConfig(stub, google) })
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const ctx = { logger }
  const engine = auth.google!

  const callback = async (options: CallbackOptions = {}) => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const started = engine.start({ redirectUrl: options.redirectUrl ?? '/trips' })

    vi.setSystemTime(Date.now() + (options.elapseMs ?? 0))

    const params = new URL(started.location).searchParams
    const code = stub.authorize(started.location, options.claims, options.sign)
    const { forge } = options

    if (forge) {
      stub.tokenResponse = async () => {
        return Response.json({ id_token: forge(params.get('nonce')!) })
      }
    }

    const result = await engine.complete(
      {
        query: { code, state: params.get('state')!, error: undefined, ...options.query },
        headers: { cookie: options.cookie ?? started.stateCookie.split(';')[0]! },
        ipAddress: IP,
        userAgent: 'vitest',
      },
      ctx,
    )

    return { started, params, code, result }
  }

  const expectFailure = (
    result: Awaited<ReturnType<typeof engine.complete>>,
    reason: GoogleSignInError,
    step: GoogleFailureStep,
    level: Level = 'warn',
  ) => {
    expect(result).toMatchObject({ ok: false, reason })
    expect(logger[level]).toHaveBeenCalledWith('Google sign-in failed', { data: { reason, step } })
  }

  return { fakes, stub, auth, engine, logger, ctx, callback, expectFailure }
}

const b64 = (value: unknown): string => {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

const handcraft = (header: object, payload: object, sign: (input: string) => string): string => {
  const input = `${b64(header)}.${b64(payload)}`

  return `${input}.${sign(input)}`
}

const claimsFor = (nonce: string) => {
  const now = Math.floor(Date.now() / 1000)

  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: SUB,
    email: 'ada@example.com',
    email_verified: true,
    hd: 'example.com',
    iat: now,
    exp: now + 3600,
    nonce,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('google sign-in: happy path', () => {
  it('signs in an allowed Workspace user and issues a google session', async () => {
    const { callback, fakes, engine, logger } = setup({ google: { hostedDomains: ['Example.com'] } })
    const onSignIn = vi.fn(async () => {})

    fakes.config.onSignIn = onSignIn

    const { result } = await callback()

    expect(result).toMatchObject({ ok: true, location: 'https://app.test/trips' })

    const [accessCookie, refreshCookie, clearCookie] = result.cookies
    const access = jwt.verify(accessCookie!.split(';')[0]!.split('=')[1]!, ACCESS_SECRET, IDENTITY) as jwt.JwtPayload

    expect(result.cookies).toHaveLength(3)
    expect(access).toMatchObject({ sub: 'u1', authMethod: 'google' })
    expect(refreshCookie).toMatch(/^refresh_token=.+; Path=\/api\/v1\/auth; Max-Age=604800$/)
    expect(clearCookie).toBe(engine.clearStateCookie())
    expect(fakes.userStore.findByEmail).toHaveBeenCalledWith('ada@example.com', expect.anything())
    expect(fakes.sessions[0]).toMatchObject({ userId: 'u1', ipAddress: IP, userAgent: 'vitest' })
    expect(logger.info).toHaveBeenCalledWith('Google sign-in succeeded', { data: { userId: 'u1' } })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('accepts the bare accounts.google.com issuer', async () => {
    const { callback } = setup()

    const { result } = await callback({ claims: { iss: 'accounts.google.com' } })

    expect(result.ok).toBe(true)
  })

  it('a baseUrl with a trailing slash yields single-slash Locations', async () => {
    const { callback } = setup({ config: { magicLink: { baseUrl: 'https://app.test/' } } })

    const success = await callback()
    const failure = await callback({ cookie: '' })

    expect(success.result.location).toBe('https://app.test/trips')
    expect(failure.result.location).toBe(`${ERROR_PAGE}?auth_error=invalid_state`)
  })
})

describe('google sign-in: token claims', () => {
  const now = () => {
    return Math.floor(Date.now() / 1000)
  }

  it.each([
    ['a wrong audience', { claims: { aud: 'someone-else.apps.googleusercontent.com' } }],
    ['a wrong issuer', { claims: { iss: 'https://evil.example' } }],
    ['an expired token', { claims: { iat: now() - 7200, exp: now() - 60 } }],
    ['a nonce mismatch', { claims: { nonce: 'another-nonce' } }],
    [
      'an HS256 token signed with the public key',
      {
        forge: (nonce: string) => {
          const stub = createGoogleStub()

          return handcraft({ alg: 'HS256', typ: 'JWT', kid: 'kid-1' }, claimsFor(nonce), (input) => {
            return crypto.createHmac('sha256', stub.publicKeyPem()).update(input).digest('base64url')
          })
        },
      },
    ],
    [
      'alg none',
      {
        forge: (nonce: string) => {
          return handcraft({ alg: 'none', kid: 'kid-1' }, claimsFor(nonce), () => {
            return ''
          })
        },
      },
    ],
  ] as [string, CallbackOptions][])(
    'refuses a wrong audience / issuer / expired / nonce mismatch / HS256 token signed with the public key / alg none: %s',
    async (_label, options) => {
      const { callback, expectFailure, fakes } = setup()

      const { result } = await callback(options)

      expectFailure(result, 'failed', 'id-token')
      expect(fakes.sessionStore.create).not.toHaveBeenCalled()
    },
  )

  it('refuses an iat or nbf beyond clockTolerance', async () => {
    for (const claims of [{ iat: now() + 60 }, { nbf: now() + 60 }]) {
      const { callback, expectFailure } = setup()

      const { result } = await callback({ claims })

      expectFailure(result, 'failed', 'id-token')
    }

    const { callback } = setup()

    expect((await callback({ claims: { iat: now() + 20, nbf: now() + 20 } })).result.ok).toBe(true)
  })
})

describe('google sign-in: email and domain', () => {
  it('refuses an unverified email', async () => {
    for (const verified of [false, 'false', undefined]) {
      const { callback, expectFailure, fakes } = setup()

      const { result } = await callback({ claims: { email_verified: verified } })

      expectFailure(result, 'not_allowed', 'email')
      expect(fakes.userStore.findByEmail).not.toHaveBeenCalled()
    }
  })

  it('accepts email_verified as the string "true"', async () => {
    const { callback } = setup()

    const { result } = await callback({ claims: { email_verified: 'true' } })

    expect(result.ok).toBe(true)
  })

  it('refuses a verified non-Gmail address without hd on the default path', async () => {
    const { callback, expectFailure, fakes } = setup()

    const { result } = await callback({ claims: { hd: undefined } })

    expectFailure(result, 'not_allowed', 'email')
    expect(fakes.userStore.findByEmail).not.toHaveBeenCalled()
  })

  it('accepts a gmail.com address without hd on the default path, matched lower-cased', async () => {
    const { callback, fakes } = setup({ seed: [invitedUser({ email: 'ada@gmail.com' })] })

    const { result } = await callback({ claims: { hd: undefined, email: ' Ada@Gmail.com' } })

    expect(result.ok).toBe(true)
    expect(fakes.userStore.findByEmail).toHaveBeenCalledWith('ada@gmail.com', expect.anything())
  })

  it('refuses an hd outside hostedDomains, even with resolveUser', async () => {
    for (const hd of ['example.com', undefined]) {
      const resolveUser = vi.fn(async () => {
        return invitedUser()
      })

      const { callback, expectFailure } = setup({ google: { hostedDomains: ['corp.test'], resolveUser } })

      const { result } = await callback({ claims: { hd } })

      expectFailure(result, 'not_allowed', 'hosted-domain')
      expect(resolveUser).not.toHaveBeenCalled()
    }
  })
})

describe('google sign-in: user resolution', () => {
  it.each([
    ['unknown', [] as TestUser[]],
    ['not allowed', [invitedUser({ invited: false })]],
  ])('refuses an unknown or not-allowed user without creating one: %s', async (_label, seed) => {
    const { callback, expectFailure, fakes } = setup({ seed })

    const { result } = await callback()

    expectFailure(result, 'not_allowed', 'user')
    expect(fakes.sessionStore.create).not.toHaveBeenCalled()
    expect(fakes.users.size).toBe(seed.length)
  })

  it('resolveUser returning null refuses even when the email matches an allowed user', async () => {
    for (const answer of [null, undefined]) {
      const { callback, expectFailure, fakes } = setup({
        google: {
          resolveUser: async () => {
            return answer
          },
        },
      })

      const { result } = await callback()

      expectFailure(result, 'not_allowed', 'user')
      expect(fakes.userStore.findByEmail).not.toHaveBeenCalled()
    }
  })

  it('resolveUser can accept a non-authoritative verified email', async () => {
    const { callback } = setup({
      google: {
        resolveUser: async () => {
          return invitedUser()
        },
      },
    })

    const { result } = await callback({ claims: { hd: undefined } })

    expect(result.ok).toBe(true)
  })

  it('resolveUser receives the identity and the host context', async () => {
    const resolveUser = vi.fn(async () => {
      return invitedUser()
    })

    const { callback, ctx } = setup({ google: { resolveUser } })

    await callback({ claims: { email: 'Ada@Example.com', hd: 'Example.com' } })

    expect(resolveUser).toHaveBeenCalledWith(
      {
        sub: SUB,
        email: 'Ada@Example.com',
        emailVerified: true,
        emailAuthoritative: true,
        hostedDomain: 'example.com',
      },
      ctx,
    )
  })

  it('isAllowed still applies to a user resolveUser returned', async () => {
    const { callback, expectFailure, fakes } = setup({
      google: {
        resolveUser: async () => {
          return invitedUser({ invited: false })
        },
      },
    })

    const { result } = await callback()

    expectFailure(result, 'not_allowed', 'user')
    expect(fakes.sessionStore.create).not.toHaveBeenCalled()
  })
})

describe('google sign-in: state and provider', () => {
  it('answers invalid_state for a missing, forged, expired or mismatched state cookie', async () => {
    const forgedState = jwt.sign({ s: 'x', n: 'x', v: 'x', r: '/', typ: 'google-state' }, 'f'.repeat(32), IDENTITY)

    const cases: [GoogleFailureStep, CallbackOptions][] = [
      ['missing-cookie', { cookie: '' }],
      ['missing-cookie', { cookie: 'access_token=abc' }],
      ['bad-signature', { cookie: `__Secure-google_oauth=${forgedState}` }],
      ['bad-signature', { cookie: '__Secure-google_oauth=not-a-jwt' }],
      ['expired', { elapseMs: 601 * 1000 }],
      ['mismatch', { query: { state: 'another-state' } }],
      ['mismatch', { query: { state: undefined } }],
    ]

    for (const [step, options] of cases) {
      const { stub, expectFailure, callback } = setup()

      const { result } = await callback(options)

      expectFailure(result, 'invalid_state', step)
      expect(result.location).toBe(`${ERROR_PAGE}?auth_error=invalid_state`)
      expect(stub.tokenRequests()).toHaveLength(0)
    }
  })

  it('accepts a callback just inside the 600 s state lifetime', async () => {
    const { callback } = setup()

    expect((await callback({ elapseMs: 590 * 1000 })).result.ok).toBe(true)
  })

  it('answers cancelled for error=access_denied', async () => {
    const { callback, expectFailure, logger, stub } = setup()

    const { result } = await callback({ query: { error: 'access_denied', code: undefined } })

    expectFailure(result, 'cancelled', 'provider-error', 'info')
    expect(result.location).toBe(`${ERROR_PAGE}?auth_error=cancelled&redirect=%2Ftrips`)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(stub.tokenRequests()).toHaveLength(0)
  })

  it('answers failed at warn level for any other provider error', async () => {
    const { callback, expectFailure, logger } = setup()

    const { result } = await callback({ query: { error: 'server_error', code: undefined } })

    expectFailure(result, 'failed', 'provider-error')
    expect(logger.info).not.toHaveBeenCalled()
  })
})

describe('google sign-in: token exchange and JWKS', () => {
  it('answers failed when the token endpoint fails or times out', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    const answers = [
      async () => {
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      },
      async () => {
        return new Response('upstream', { status: 503 })
      },
      async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
    ]

    for (const answer of answers) {
      const { callback, expectFailure, stub } = setup()

      stub.tokenResponse = answer

      const { result } = await callback()

      expectFailure(result, 'failed', 'token-exchange')
      expect(stub.tokenRequests()[0]!.init!.signal).toBeInstanceOf(AbortSignal)
    }

    expect(timeout).toHaveBeenCalledWith(5000)
  })

  it('answers failed without calling Google when the callback carries no code', async () => {
    const { callback, expectFailure, stub } = setup()

    const { result } = await callback({ query: { code: undefined } })

    expectFailure(result, 'failed', 'token-exchange')
    expect(stub.tokenRequests()).toHaveLength(0)
  })

  it('answers failed for a token response without id_token', async () => {
    for (const body of [{ access_token: 'ya29.access' }, { id_token: '' }, { id_token: 42 }, null, 'id_token']) {
      const { callback, expectFailure, stub } = setup()

      stub.tokenResponse = async () => {
        return Response.json(body)
      }

      const { result } = await callback()

      expectFailure(result, 'failed', 'token-exchange')
    }
  })

  it('answers failed for a non-JSON token response', async () => {
    const { callback, expectFailure, stub } = setup()

    stub.tokenResponse = async () => {
      return new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }

    const { result } = await callback()

    expectFailure(result, 'failed', 'token-exchange')
  })

  it('answers failed when the kid is missing, or absent after one refetch', async () => {
    const missing = setup()

    missing.expectFailure((await missing.callback({ sign: { kid: null } })).result, 'failed', 'jwks')
    expect(missing.stub.jwksFetches()).toBe(0)

    const { callback, stub, expectFailure: expectAbsent } = setup()

    expect((await callback()).result.ok).toBe(true)
    expect(stub.jwksFetches()).toBe(1)

    stub.rotateKey('kid-unpublished', { publish: false })

    expectAbsent((await callback()).result, 'failed', 'jwks')
    expect(stub.jwksFetches()).toBe(2)

    expectAbsent((await callback()).result, 'failed', 'jwks')
    expect(stub.jwksFetches()).toBe(2)
  })

  it('answers failed when the JWKS endpoint fails', async () => {
    const answers = [
      async () => {
        return new Response('down', { status: 500 })
      },
      async () => {
        throw new TypeError('fetch failed')
      },
      async () => {
        return new Response('not json')
      },
      async () => {
        return Response.json({ keys: 'none' })
      },
      async () => {
        return Response.json({ jwks: [] })
      },
      async () => {
        return Response.json(null)
      },
      async () => {
        return Response.json({ keys: [{ kid: 'kid-1', kty: 'RSA', n: 'broken' }] })
      },
    ]

    for (const answer of answers) {
      const { callback, expectFailure, stub } = setup()

      stub.jwksResponse = answer

      expectFailure((await callback()).result, 'failed', 'jwks')
    }
  })

  it('caches the JWKS and refetches once for an unknown kid', async () => {
    const { callback, stub, logger } = setup()

    expect((await callback()).result.ok).toBe(true)
    expect((await callback()).result.ok).toBe(true)
    expect(stub.jwksFetches()).toBe(1)
    expect(logger.info).toHaveBeenCalledWith('Google JWKS refreshed', { data: { keyCount: 1 } })

    stub.rotateKey('kid-2')

    expect((await callback()).result.ok).toBe(true)
    expect(stub.jwksFetches()).toBe(2)
    expect(logger.info).toHaveBeenCalledWith('Google JWKS refreshed', { data: { keyCount: 2 } })
    expect(
      stub.requests.find((request) => {
        return request.url.includes('certs')
      })!.init!.signal,
    ).toBeInstanceOf(AbortSignal)
  })
})

describe('google sign-in: limits and failures', () => {
  it('answers rate_limited past perIpVerify', async () => {
    const { callback, expectFailure, fakes, stub } = setup({ config: { rateLimits: { perIpVerify: 1 } } })

    expect((await callback()).result.ok).toBe(true)

    expectFailure((await callback()).result, 'rate_limited', 'rate-limit')
    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenLastCalledWith(
      `magic:google:ip:${IP}`,
      1,
      3600,
      expect.anything(),
    )
    expect(stub.tokenRequests()).toHaveLength(1)
  })

  it('answers failed when the rate limiter throws', async () => {
    const { callback, fakes, stub, logger } = setup()

    fakes.rateLimiter.incrementAndCheck.mockRejectedValueOnce(new Error('redis down'))

    const { result } = await callback()

    expect(result).toMatchObject({ ok: false, reason: 'failed' })
    expect(logger.error).toHaveBeenCalledWith('Google sign-in failed', {
      data: { reason: 'failed', step: 'store', name: 'Error' },
    })
    expect(stub.tokenRequests()).toHaveLength(0)
  })

  it('answers failed and logs when a store throws', async () => {
    const thrown = [
      setup(),
      setup({
        google: {
          resolveUser: async () => {
            throw new RangeError('db down')
          },
        },
      }),
    ]

    thrown[0]!.fakes.userStore.findByEmail.mockRejectedValueOnce(new RangeError('db down'))

    for (const { callback, logger } of thrown) {
      const { result } = await callback()

      expect(result).toMatchObject({
        ok: false,
        reason: 'failed',
        location: `${ERROR_PAGE}?auth_error=failed&redirect=%2Ftrips`,
      })
      expect(logger.error).toHaveBeenCalledWith('Google sign-in failed', {
        data: { reason: 'failed', step: 'store', name: 'RangeError' },
      })
    }
  })

  it('answers failed when onSignIn or issueSession throws', async () => {
    const onSignInFails = setup({
      config: {
        onSignIn: async () => {
          throw new Error('audit log down')
        },
      },
    })

    const issueFails = setup()

    issueFails.fakes.sessionStore.create.mockRejectedValueOnce(new Error('db down'))

    for (const { callback, logger, engine } of [onSignInFails, issueFails]) {
      const { result } = await callback()

      expect(result).toMatchObject({ ok: false, reason: 'failed' })
      expect(result.cookies).toEqual([engine.clearStateCookie()])
      expect(logger.error).toHaveBeenCalledWith('Google sign-in failed', {
        data: { reason: 'failed', step: 'store', name: 'Error' },
      })
    }
  })
})

describe('google sign-in: redirects and cookies', () => {
  it('never lets a redirect leave the configured origin', async () => {
    for (const redirectUrl of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const { callback } = setup()

      const { result } = await callback({ redirectUrl })

      expect(result).toMatchObject({ ok: true, location: 'https://app.test/' })
    }

    const { callback, expectFailure, engine } = setup()
    const started = engine.start({ redirectUrl: '/trips' })
    const [header, payload, signature] = started.stateCookie.split(';')[0]!.split('=')[1]!.split('.')
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<string, unknown>
    const tampered = `${header}.${b64({ ...claims, r: '//evil.com' })}.${signature}`

    const { result } = await callback({ cookie: `__Secure-google_oauth=${tampered}` })

    expectFailure(result, 'invalid_state', 'bad-signature')
    expect(result.location).toBe(`${ERROR_PAGE}?auth_error=invalid_state`)
  })

  it('the error location keeps a non-root redirect', async () => {
    const { callback } = setup({ seed: [] })

    const { result } = await callback({ redirectUrl: '/trips?tab=2' })

    expect(result.location).toBe(`${ERROR_PAGE}?auth_error=not_allowed&redirect=%2Ftrips%3Ftab%3D2`)
  })

  it('clears the state cookie on every outcome', async () => {
    const { engine } = setup()
    const clear = engine.clearStateCookie()

    expect(clear).toBe(
      '__Secure-google_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/google/callback; Max-Age=0',
    )

    const outcomes = [
      await setup().callback(),
      await setup().callback({ cookie: '' }),
      await setup().callback({ query: { error: 'access_denied' } }),
      await setup({ seed: [] }).callback(),
      await setup({ config: { rateLimits: { perIpVerify: 1 } } }).callback({ query: { code: undefined } }),
    ]

    for (const { result } of outcomes) {
      expect(result.cookies.at(-1)).toBe(clear)
    }

    for (const { result } of outcomes.slice(1)) {
      expect(result.cookies).toEqual([clear])
    }
  })
})

describe('google sign-in: requests and logs', () => {
  it('sends PKCE, the client secret and the exact redirect_uri to Google', async () => {
    const { callback, stub } = setup()

    const { started, params, code, result } = await callback()

    expect(result.ok).toBe(true)
    expect(started.location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
    expect(Object.fromEntries(params)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email',
      state: expect.stringMatching(/^[\w-]{43}$/),
      nonce: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })

    const [request] = stub.tokenRequests()
    const body = new URLSearchParams(String(request!.init!.body))

    expect(request!.init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(Object.fromEntries(body)).toEqual({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: expect.stringMatching(/^[\w-]{43}$/),
    })
    expect(pkceChallenge(body.get('code_verifier')!)).toBe(params.get('code_challenge'))
  })

  it('adds the hd hint only for exactly one hosted domain', () => {
    const one = setup({ google: { hostedDomains: ['Example.com'] } }).engine.start({ redirectUrl: undefined })

    const two = setup({ google: { hostedDomains: ['example.com', 'corp.test'] } }).engine.start({
      redirectUrl: undefined,
    })

    expect(new URL(one.location).searchParams.get('hd')).toBe('example.com')
    expect(new URL(two.location).searchParams.has('hd')).toBe(false)
  })

  it('logs no token, code, email or sub', async () => {
    const runs = [setup(), setup({ seed: [] }), setup(), setup(), setup()]

    runs[4]!.fakes.userStore.findByEmail.mockRejectedValueOnce(new Error('db down'))

    const results = [
      await runs[0]!.callback(),
      await runs[1]!.callback(),
      await runs[2]!.callback({ query: { error: 'access_denied' } }),
      await runs[3]!.callback({ claims: { nonce: 'wrong' } }),
      await runs[4]!.callback(),
    ]

    const logged = JSON.stringify(
      runs.flatMap(({ logger }) => {
        return [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]
      }),
    )

    const cookieValues = (cookies: string[]) => {
      return cookies
        .map((cookie) => {
          return cookie.split(';')[0]!.split('=')[1]!
        })
        .filter(Boolean)
    }

    const secrets = results.flatMap(({ code, params, started, result }) => {
      return [
        code,
        params.get('state')!,
        params.get('nonce')!,
        params.get('code_challenge')!,
        ...cookieValues([started.stateCookie, ...result.cookies]),
      ]
    })

    expect(logged).toContain('Google sign-in succeeded')
    expect(logged).toContain('Google sign-in failed')

    for (const secret of [...secrets, SUB, 'ada@example.com', CLIENT_SECRET, 'eyJ']) {
      expect(logged).not.toContain(secret)
    }
  })
})
