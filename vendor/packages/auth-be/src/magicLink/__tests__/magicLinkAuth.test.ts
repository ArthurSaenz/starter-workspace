/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/assertions-in-tests -- fixture client IPs; `expectAuthError` asserts, and the rule does not follow helpers */
import jwt from 'jsonwebtoken'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { expectAuthError, signIn } from '../../__tests__/helpers/engine.js'
import type { TestUser } from '../../__tests__/helpers/fakes.js'
import { ACCESS_SECRET, IDENTITY, createFakes, invitedUser, tokenFromEmail } from '../../__tests__/helpers/fakes.js'
import type { RefreshSessionInput, TokenPair } from '../../session/types.js'
import { hashToken } from '../../tokens.js'
import type { RenderMagicLinkEmail } from '../email.js'
import type { MagicLinkAuth } from '../magicLinkAuth.js'
import { createMagicLinkAuth } from '../magicLinkAuth.js'

const withRenderEmail = (
  fakes: ReturnType<typeof createFakes>,
  renderEmail: RenderMagicLinkEmail<object> | undefined,
): ReturnType<typeof createFakes>['config'] => {
  const config: ReturnType<typeof createFakes>['config'] = { ...fakes.config }

  delete config.email

  if (renderEmail) config.renderEmail = renderEmail

  return config
}

describe('createMagicLinkAuth config guards', () => {
  it.each([
    ['short access secret', { accessSecret: 'short' }],
    ['short refresh secret', { refreshSecret: 'short' }],
    ['identical secrets', { refreshSecret: ACCESS_SECRET }],
  ])('refuses %s', (_label, jwtOverride) => {
    const { config } = createFakes()

    expect(() => {
      return createMagicLinkAuth({ ...config, jwt: { ...config.jwt, ...jwtOverride } })
    }).toThrow()
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses minResponseMs %s', (minResponseMs) => {
    const { config } = createFakes()

    expect(() => {
      return createMagicLinkAuth({ ...config, minResponseMs })
    }).toThrow(/minResponseMs/)
  })

  it('refuses a missing magic-link base URL', () => {
    const { config } = createFakes()

    expect(() => {
      return createMagicLinkAuth({ ...config, magicLink: { baseUrl: '' } })
    }).toThrow(/baseUrl/)
  })

  it('refuses neither of email and renderEmail', () => {
    const config = withRenderEmail(createFakes(), undefined)

    expect(() => {
      return createMagicLinkAuth(config)
    }).toThrow(/exactly one of email or renderEmail/)
  })

  it('refuses both email and renderEmail', () => {
    const { config } = createFakes()

    expect(() => {
      return createMagicLinkAuth({ ...config, renderEmail: vi.fn() })
    }).toThrow(/exactly one of email or renderEmail/)
  })
})

describe('renderEmail', () => {
  const rendered = { to: 'x', subject: 'Custom', text: 'custom text', html: '<b>custom</b>' }

  it.each([
    ['sign-in', 15],
    ['invite', 72 * 60],
  ] as const)('renders a %s email through the host renderer with the matching TTL', async (kind, expMin) => {
    const fakes = createFakes([invitedUser()])

    const renderEmail = vi.fn(async () => {
      return rendered
    })

    const ctx = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
    const auth = createMagicLinkAuth(withRenderEmail(fakes, renderEmail))

    if (kind === 'invite') await auth.sendInviteLink('ada@example.com', ctx)
    else await auth.requestMagicLink({ email: 'ada@example.com' }, ctx)

    expect(renderEmail).toHaveBeenCalledWith(
      { to: 'ada@example.com', link: expect.stringContaining('https://app.test/auth/verify?token='), expMin, kind },
      ctx,
    )
    expect(fakes.sent).toEqual([rendered])
  })

  it('invalidates the token when the host renderer throws', async () => {
    const fakes = createFakes([invitedUser()])

    const renderEmail = vi.fn(() => {
      throw new Error('template broke')
    })

    await createMagicLinkAuth(withRenderEmail(fakes, renderEmail)).requestMagicLink({ email: 'ada@example.com' })

    expect(fakes.tokens[0]!.spent).toBe(true)
    expect(fakes.sent).toHaveLength(0)
  })
})

describe('requestMagicLink', () => {
  it('emails an invited user a single-use link carrying the sanitised redirect', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth(fakes.config)

    await auth.requestMagicLink({ email: '  ADA@example.com ', redirectUrl: '/trips?x=1', ipAddress: '1.1.1.1' })

    expect(fakes.sent).toHaveLength(1)
    expect(fakes.sent[0]!.to).toBe('ada@example.com')
    expect(fakes.sent[0]!.text).toContain('https://app.test/auth/verify?token=')
    expect(fakes.sent[0]!.text).toContain('&redirect=%2Ftrips%3Fx%3D1')
    expect(fakes.sent[0]!.text).toContain('This link expires in 15 minutes.')
    expect(fakes.tokens[0]).toMatchObject({ email: 'ada@example.com', redirectUrl: '/trips?x=1', ipAddress: '1.1.1.1' })
    expect(fakes.tokens[0]!.tokenHash).toBe(hashToken(tokenFromEmail(fakes.sent[0]!)))
  })

  it('leaves the redirect off a link that lands on /', async () => {
    const fakes = createFakes([invitedUser()])

    await createMagicLinkAuth(fakes.config).requestMagicLink({ email: 'ada@example.com' })

    expect(fakes.sent[0]!.text).toContain('https://app.test/auth/verify?token=')
    expect(fakes.sent[0]!.text).not.toContain('redirect=')
  })

  it.each([
    ['unknown', []],
    ['uninvited', [invitedUser({ invited: false })]],
  ])('answers silently for an %s address and creates nothing', async (_label, seed) => {
    const fakes = createFakes(seed)

    await createMagicLinkAuth(fakes.config).requestMagicLink({ email: 'ada@example.com' })

    expect(fakes.tokens).toHaveLength(0)
    expect(fakes.sent).toHaveLength(0)
  })

  it('throws NOT_INVITED for an uninvited address when the host chose `reject`', async () => {
    const fakes = createFakes([invitedUser({ invited: false })])
    const auth = createMagicLinkAuth({ ...fakes.config, uninvitedRequest: 'reject', notInvitedMessage: 'No.' })

    await expectAuthError(auth.requestMagicLink({ email: 'ada@example.com' }), 'NOT_INVITED', 403)
    expect(fakes.sent).toHaveLength(0)
  })

  describe('minResponseMs', () => {
    const settleTime = async (promise: Promise<unknown>): Promise<number> => {
      const startedAt = Date.now()

      const settledAt = promise.then(
        () => {
          return Date.now()
        },
        () => {
          return Date.now()
        },
      )

      await vi.runAllTimersAsync()

      return (await settledAt) - startedAt
    }

    it.each([
      ['an invited address that is emailed', [invitedUser()]],
      ['an unknown address', []],
    ])('answers %s no sooner than the floor', async (_label, seed) => {
      vi.useFakeTimers()

      try {
        const auth = createMagicLinkAuth({ ...createFakes(seed).config, minResponseMs: 400 })

        expect(await settleTime(auth.requestMagicLink({ email: 'ada@example.com' }))).toBe(400)
      } finally {
        vi.useRealTimers()
      }
    })

    it('holds a rejection to the floor too', async () => {
      vi.useFakeTimers()

      try {
        const fakes = createFakes([invitedUser({ invited: false })])
        const auth = createMagicLinkAuth({ ...fakes.config, uninvitedRequest: 'reject', minResponseMs: 400 })
        const request = auth.requestMagicLink({ email: 'ada@example.com' })
        const outcome = expectAuthError(request, 'NOT_INVITED', 403)

        expect(await settleTime(request)).toBe(400)
        await outcome
      } finally {
        vi.useRealTimers()
      }
    })

    it('adds nothing when the work already took longer than the floor', async () => {
      vi.useFakeTimers()

      try {
        const fakes = createFakes([invitedUser()])
        const slowFind = fakes.userStore.findByEmail.getMockImplementation()!

        fakes.userStore.findByEmail.mockImplementation(async (...args) => {
          await new Promise((resolve) => {
            setTimeout(resolve, 900)
          })

          return slowFind(...args)
        })

        const auth = createMagicLinkAuth({ ...fakes.config, minResponseMs: 400 })

        expect(await settleTime(auth.requestMagicLink({ email: 'ada@example.com' }))).toBe(900)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('swallows a validation failure', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth(fakes.config)

    await auth.requestMagicLink({ email: 'not-an-email' })
    await auth.requestMagicLink({ email: 'ada@example.com', redirectUrl: '/a\\b' })

    expect(fakes.userStore.findByEmail).not.toHaveBeenCalled()
  })

  it('uses a host validator in place of the built-in one', async () => {
    const fakes = createFakes([invitedUser()])

    const requestMagicLink = vi.fn(() => {
      throw new Error('nope')
    })

    await createMagicLinkAuth({ ...fakes.config, validate: { requestMagicLink } }).requestMagicLink({
      email: 'ada@example.com',
    })

    expect(requestMagicLink).toHaveBeenCalledWith({ email: 'ada@example.com', redirectUrl: undefined }, undefined)
    expect(fakes.sent).toHaveLength(0)
  })

  it('stops quietly past the per-email and per-IP budgets, under the configured key prefix', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth({ ...fakes.config, rateLimits: { perEmail: 2, keyPrefix: 'bo' } })

    for (let i = 0; i < 3; i++) await auth.requestMagicLink({ email: 'ada@example.com', ipAddress: '9.9.9.9' })

    expect(fakes.sent).toHaveLength(2)
    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('bo:email:ada@example.com', 2, 3600, undefined)
    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('bo:ip:9.9.9.9', 20, 3600, undefined)
  })

  it('invalidates the previous outstanding link', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth(fakes.config)

    await auth.requestMagicLink({ email: 'ada@example.com' })
    await auth.requestMagicLink({ email: 'ada@example.com' })

    await expectAuthError(
      auth.verifyMagicLink({ rawToken: tokenFromEmail(fakes.sent[0]!) }),
      'INVALID_OR_EXPIRED_TOKEN',
      401,
    )
  })

  it('invalidates the token when the email could not be sent', async () => {
    const fakes = createFakes([invitedUser()])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    fakes.mailer.send.mockRejectedValueOnce(new Error('provider down'))

    await createMagicLinkAuth(fakes.config).requestMagicLink({ email: 'ada@example.com' }, { logger })

    expect(fakes.tokens[0]!.spent).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('logs, not throws, when the cleanup after a failed send fails too', async () => {
    const fakes = createFakes([invitedUser()])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    fakes.mailer.send.mockRejectedValueOnce(new Error('provider down'))
    fakes.magicTokens.invalidateByEmail.mockResolvedValueOnce().mockRejectedValueOnce(new Error('db down'))

    await createMagicLinkAuth(fakes.config).requestMagicLink({ email: 'ada@example.com' }, { logger })

    expect(logger.error).toHaveBeenCalledTimes(2)
  })
})

describe('sendInviteLink', () => {
  it('emails without the allowlist or rate limit, with the invite TTL', async () => {
    const fakes = createFakes()

    await createMagicLinkAuth(fakes.config).sendInviteLink(' New@Example.com ')

    expect(fakes.sent[0]!.to).toBe('new@example.com')
    expect(fakes.sent[0]!.text).toContain('This link expires in 3 days.')
    expect(fakes.rateLimiter.incrementAndCheck).not.toHaveBeenCalled()
    expect((fakes.tokens[0]!.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(71 * 3600 * 1000)
  })

  it('reports a delivered email', async () => {
    const fakes = createFakes()

    await expect(createMagicLinkAuth(fakes.config).sendInviteLink('new@example.com')).resolves.toEqual({
      emailSent: true,
    })
  })

  it('reports an undelivered email after invalidating its token', async () => {
    const fakes = createFakes()

    fakes.mailer.send.mockRejectedValueOnce(new Error('provider down'))

    await expect(createMagicLinkAuth(fakes.config).sendInviteLink('new@example.com')).resolves.toEqual({
      emailSent: false,
    })
    expect(fakes.magicTokens.invalidateByEmail).toHaveBeenCalledTimes(2)
    expect(fakes.magicTokens.invalidateByEmail.mock.invocationCallOrder[1]!).toBeGreaterThan(
      fakes.mailer.send.mock.invocationCallOrder[0]!,
    )
    expect(fakes.tokens[0]!.spent).toBe(true)
  })

  it('reports an undelivered email, without throwing, when the cleanup fails too', async () => {
    const fakes = createFakes()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    fakes.mailer.send.mockRejectedValueOnce(new Error('provider down'))
    fakes.magicTokens.invalidateByEmail.mockResolvedValueOnce().mockRejectedValueOnce(new Error('db down'))

    await expect(createMagicLinkAuth(fakes.config).sendInviteLink('new@example.com', { logger })).resolves.toEqual({
      emailSent: false,
    })
    expect(logger.error).toHaveBeenCalledWith('Failed to invalidate the undelivered magic token', {
      data: { name: 'Error' },
    })
  })

  it('reports an undelivered email when the renderer throws', async () => {
    const fakes = createFakes()

    const renderEmail = vi.fn(() => {
      throw new Error('template broke')
    })

    await expect(
      createMagicLinkAuth(withRenderEmail(fakes, renderEmail)).sendInviteLink('new@example.com'),
    ).resolves.toEqual({ emailSent: false })
    expect(fakes.tokens[0]!.spent).toBe(true)
  })

  it.each(['', '   ', undefined])('reports %j as undelivered without minting a link', async (email) => {
    const fakes = createFakes()

    await expect(createMagicLinkAuth(fakes.config).sendInviteLink(email as string)).resolves.toEqual({
      emailSent: false,
    })
    expect(fakes.tokens).toHaveLength(0)
    expect(fakes.mailer.send).not.toHaveBeenCalled()
  })

  it('leaves a sign-in request silent when the mailer fails', async () => {
    const fakes = createFakes([invitedUser()])

    fakes.mailer.send.mockRejectedValueOnce(new Error('provider down'))

    await expect(
      createMagicLinkAuth(fakes.config).requestMagicLink({ email: 'ada@example.com' }),
    ).resolves.toBeUndefined()
  })
})

describe('engine shape', () => {
  it('keeps its method set and return types', () => {
    const auth = createMagicLinkAuth(createFakes().config)

    const keys: Record<keyof MagicLinkAuth<TestUser, { id: string; email: string }, object>, true> = {
      cookies: true,
      identity: true,
      uninvitedRequest: true,
      requestMagicLink: true,
      sendInviteLink: true,
      verifyMagicLink: true,
      refreshSession: true,
      logout: true,
      requireUser: true,
      authenticate: true,
      getMe: true,
      issueSession: true,
      extractAccessToken: true,
      extractRefreshToken: true,
      clearCookies: true,
    }

    expect(Object.keys(keys)).toHaveLength(15)
    expect(Object.keys(auth).sort()).toEqual(Object.keys(keys).sort())
    expectTypeOf(auth.sendInviteLink).returns.resolves.toEqualTypeOf<{ emailSent: boolean }>()
    expectTypeOf(auth.issueSession).returns.resolves.toEqualTypeOf<TokenPair>()
    expectTypeOf(auth.refreshSession).returns.resolves.toEqualTypeOf<TokenPair>()
    expectTypeOf(auth.refreshSession).parameter(0).toEqualTypeOf<RefreshSessionInput>()
  })

  it('issues a session when issueSession is called unbound', async () => {
    const { issueSession } = createMagicLinkAuth(createFakes([invitedUser()]).config)

    await expect(issueSession(invitedUser())).resolves.toMatchObject({ accessToken: expect.any(String) })
  })
})

describe('verifyMagicLink', () => {
  it('mints a session pinned to the configured identity and returns the stored redirect', async () => {
    const fakes = createFakes([invitedUser()])
    const onSignIn = vi.fn(async () => {})

    fakes.config.onSignIn = onSignIn

    const { result } = await signIn(fakes)
    const access = jwt.verify(result.accessToken, ACCESS_SECRET, IDENTITY) as jwt.JwtPayload

    expect(access).toMatchObject({ sub: 'u1', roles: ['user'], authMethod: 'magic' })
    expect(result.redirectUrl).toBe('/trips')
    expect(result.accessCookie).toMatch(/^access_token=.+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=900$/)
    expect(result.refreshCookie).toMatch(/; Path=\/api\/v1\/auth; Max-Age=604800$/)
    expect(fakes.sessions[0]).toMatchObject({ userId: 'u1', tokenHash: hashToken(result.refreshToken) })
    expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), undefined)
  })

  it('takes the roles claim from rolesOf', async () => {
    const fakes = createFakes([invitedUser({ roles: [] })])

    fakes.config.rolesOf = (user) => {
      return user.roles.length ? user.roles : ['user']
    }

    const { result } = await signIn(fakes)

    expect((jwt.decode(result.accessToken) as { roles: string[] }).roles).toEqual(['user'])
  })

  it('spends the token once', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth(fakes.config)

    await auth.requestMagicLink({ email: 'ada@example.com' })

    const rawToken = tokenFromEmail(fakes.sent[0]!)

    await auth.verifyMagicLink({ rawToken })
    await expectAuthError(auth.verifyMagicLink({ rawToken }), 'INVALID_OR_EXPIRED_TOKEN', 401)
  })

  it.each([
    ['past', new Date(Date.now() - 1000)],
    ['unparseable', 'not a date'],
  ])('refuses a token whose expiry is %s', async (_label, expiresAt) => {
    const fakes = createFakes([invitedUser()])

    fakes.magicTokens.consumeByHash.mockResolvedValueOnce({ email: 'ada@example.com', expiresAt })

    await expectAuthError(
      createMagicLinkAuth(fakes.config).verifyMagicLink({ rawToken: 'ab'.repeat(32) }),
      'INVALID_OR_EXPIRED_TOKEN',
      401,
    )
  })

  it("refuses a token older than this host's longest TTL, whatever its own expiry says", async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth({ ...fakes.config, magicLink: { baseUrl: 'https://app.test', inviteTtlMin: 15 } })

    fakes.magicTokens.consumeByHash.mockResolvedValueOnce({
      email: 'ada@example.com',
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      expiresAt: new Date(Date.now() + 70 * 3600 * 1000),
    })

    await expectAuthError(auth.verifyMagicLink({ rawToken: 'ab'.repeat(32) }), 'INVALID_OR_EXPIRED_TOKEN', 401)
  })

  it.each([
    ['unparseable', 'not-a-date'],
    ['null', null as never],
  ])('refuses a token whose createdAt is %s', async (_label, createdAt) => {
    const fakes = createFakes([invitedUser()])

    fakes.magicTokens.consumeByHash.mockResolvedValueOnce({
      email: 'ada@example.com',
      createdAt,
      expiresAt: new Date(Date.now() + 60_000),
    })

    await expectAuthError(
      createMagicLinkAuth(fakes.config).verifyMagicLink({ rawToken: 'ab'.repeat(32) }),
      'INVALID_OR_EXPIRED_TOKEN',
      401,
    )
  })

  it('keeps a default rate limit when an override is undefined', async () => {
    const fakes = createFakes([invitedUser()])

    await createMagicLinkAuth({
      ...fakes.config,
      rateLimits: { perEmail: undefined as unknown as number },
    }).requestMagicLink({
      email: 'ada@example.com',
    })

    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('magic:email:ada@example.com', 5, 3600, undefined)
  })

  it('re-checks the allowlist: an invite revoked after the request is refused', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth(fakes.config)

    await auth.requestMagicLink({ email: 'ada@example.com' })
    fakes.users.get('u1')!.invited = false

    await expectAuthError(auth.verifyMagicLink({ rawToken: tokenFromEmail(fakes.sent[0]!) }), 'NOT_INVITED', 403)
    expect(fakes.sessions).toHaveLength(0)
  })

  it('refuses a non-hex token before touching the store', async () => {
    const fakes = createFakes([invitedUser()])

    await expectAuthError(createMagicLinkAuth(fakes.config).verifyMagicLink({ rawToken: 'zz' }), 'INVALID_REQUEST', 400)
    expect(fakes.magicTokens.consumeByHash).not.toHaveBeenCalled()
  })

  it('rate-limits verification per IP', async () => {
    const fakes = createFakes([invitedUser()])

    fakes.rateLimiter.limitOverride = 0

    await expectAuthError(
      createMagicLinkAuth(fakes.config).verifyMagicLink({ rawToken: 'ab'.repeat(32), ipAddress: '1.1.1.1' }),
      'RATE_LIMITED',
      429,
    )
  })

  it('maps errors through the host factory', async () => {
    const fakes = createFakes([invitedUser()])

    const createError = vi.fn((init: { code: string }) => {
      return new Error(`host:${init.code}`)
    })

    await expect(
      createMagicLinkAuth({ ...fakes.config, createError }).verifyMagicLink({ rawToken: 'ab'.repeat(32) }),
    ).rejects.toThrow('host:INVALID_OR_EXPIRED_TOKEN')
  })
})

describe('a missing client IP', () => {
  it('shares the `unknown` per-IP bucket instead of skipping the limit', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    await auth.verifyMagicLink({ rawToken: 'ab'.repeat(32) }).catch(() => {
      return undefined
    })
    await auth.refreshSession({ refreshToken: result.refreshToken })

    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('magic:ip:unknown', 20, 3600, undefined)
    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('magic:verify:ip:unknown', 30, 3600, undefined)
    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('magic:refresh:ip:unknown', 60, 3600, undefined)
  })
})
