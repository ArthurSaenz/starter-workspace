/* eslint-disable sonarjs/no-hardcoded-ip -- fixture client IPs */
import { describe, expect, it, vi } from 'vitest'

import { createAuthRoutes, extractSourceIp, toLambdaHandler } from '../lambda.js'
import { createMagicLinkAuth } from '../magicLinkAuth.js'
import { createFakes, invitedUser, tokenFromEmail } from './helpers/fakes.js'

const CORS = { 'Access-Control-Allow-Origin': 'https://app.test', 'Access-Control-Allow-Credentials': 'true' }

const setup = (uninvitedRequest: 'silent' | 'reject' = 'silent') => {
  const fakes = createFakes([invitedUser()])
  const auth = createMagicLinkAuth({ ...fakes.config, uninvitedRequest })

  const routes = createAuthRoutes(auth, {
    corsHeaders: () => {
      return CORS
    },
    clientIp: { trustedProxyHops: 0 },
  })

  const wrap = (route: (typeof routes)[keyof typeof routes]) => {
    return toLambdaHandler(route, {
      corsHeaders: () => {
        return CORS
      },
      clearCookies: auth.clearCookies,
    })
  }

  return { fakes, auth, routes, wrap }
}

const signedIn = async () => {
  const ctx = setup()

  await ctx.wrap(ctx.routes.requestMagicLink)({ body: JSON.stringify({ email: 'ada@example.com' }) })

  const verified = await ctx.wrap(ctx.routes.verifyMagicLink)({
    queryStringParameters: { token: tokenFromEmail(ctx.fakes.sent[0]!) },
  })

  const [accessCookie, refreshCookie] = verified.multiValueHeaders!['Set-Cookie']!
  const cookie = `${accessCookie!.split(';')[0]}; ${refreshCookie!.split(';')[0]}`

  return { ...ctx, verified, cookie }
}

describe('auth routes', () => {
  it('requestMagicLink answers the generic body whatever the outcome', async () => {
    const { routes, wrap, fakes } = setup()
    const handler = wrap(routes.requestMagicLink)
    const expected = { message: 'If that email exists, a sign-in link has been sent.' }

    for (const body of ['{"email":"ada@example.com"}', '{"email":"nobody@example.com"}', 'not json', null]) {
      const result = await handler({
        body,
        headers: { 'X-Forwarded-For': '6.6.6.6, 10.0.0.1' },
        requestContext: { identity: { sourceIp: '1.2.3.4' } },
      })

      expect(result.statusCode).toBe(200)
      expect(JSON.parse(result.body)).toEqual(expected)
    }

    fakes.userStore.findByEmail.mockRejectedValueOnce(new Error('db down'))
    expect((await handler({ body: '{"email":"ada@example.com"}' })).statusCode).toBe(200)
    expect(fakes.rateLimiter.incrementAndCheck).toHaveBeenCalledWith('magic:ip:1.2.3.4', 20, 3600, undefined)
  })

  it('requestMagicLink surfaces NOT_INVITED on a `reject` host', async () => {
    const { routes, wrap } = setup('reject')
    const result = await wrap(routes.requestMagicLink)({ body: '{"email":"nobody@example.com"}' })

    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body)).toMatchObject({ type: 'NOT_INVITED' })
  })

  it('verifyMagicLink answers JSON with both cookies, not a redirect', async () => {
    const { verified } = await signedIn()

    expect(verified.statusCode).toBe(200)
    expect(JSON.parse(verified.body)).toEqual({ ok: true, redirect: '/' })
    expect(verified.headers).toEqual(CORS)
  })

  it('verifyMagicLink maps a bad token to the error envelope', async () => {
    const { routes, wrap } = setup()
    const result = await wrap(routes.verifyMagicLink)({ queryStringParameters: { token: 'ab'.repeat(32) } })

    expect(result.statusCode).toBe(401)
    expect(JSON.parse(result.body)).toMatchObject({ type: 'INVALID_OR_EXPIRED_TOKEN' })
  })

  it('me answers the host DTO for a signed-in cookie and 401 without one', async () => {
    const { routes, wrap, cookie } = await signedIn()

    const me = await wrap(routes.me)({ headers: { Cookie: cookie } })

    expect(JSON.parse(me.body)).toEqual({ id: 'u1', email: 'ada@example.com' })
    expect((await wrap(routes.me)({ headers: {} })).statusCode).toBe(401)
  })

  it('refresh rotates the cookies, and clears them on a 401', async () => {
    const { routes, wrap, cookie } = await signedIn()

    const refreshed = await wrap(routes.refresh)({ headers: { cookie } })

    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.multiValueHeaders!['Set-Cookie']).toHaveLength(2)

    const replay = await wrap(routes.refresh)({ headers: { cookie } })

    expect(replay.statusCode).toBe(401)
    expect(
      replay.multiValueHeaders!['Set-Cookie']!.every((c) => {
        return c.endsWith('Max-Age=0')
      }),
    ).toBe(true)
  })

  it('logout always answers 204 with clearing cookies', async () => {
    const { routes, wrap, cookie, fakes } = await signedIn()

    fakes.sessionStore.revokeByTokenHash.mockRejectedValueOnce(new Error('db down'))

    for (const headers of [{ cookie }, {}]) {
      const result = await wrap(routes.logout)({ headers })

      expect(result.statusCode).toBe(204)
      expect(result.multiValueHeaders!['Set-Cookie']).toHaveLength(2)
    }
  })

  it('toLambdaHandler hands unknown errors to onError and answers 500, or the host mapping', async () => {
    const { routes, auth } = setup()
    const onError = vi.fn()
    const boom = { handle: vi.fn().mockRejectedValue(new Error('boom')) }

    const base = {
      corsHeaders: () => {
        return CORS
      },
      clearCookies: auth.clearCookies,
    }

    expect((await toLambdaHandler(boom, { ...base, onError })({})).statusCode).toBe(500)
    expect(onError).toHaveBeenCalled()

    const mapped = await toLambdaHandler(routes.me, {
      ...base,
      toErrorResponse: () => {
        return { statusCode: 418, body: { type: 'HOST' } }
      },
    })({})

    expect(mapped).toMatchObject({ statusCode: 418, body: '{"type":"HOST"}' })
  })

  it('passes the host context to the engine', async () => {
    const { fakes, auth } = setup()
    const ctx = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

    const routes = createAuthRoutes(auth, {
      corsHeaders: () => {
        return CORS
      },
      requestMagicLinkMessage: 'Check your inbox.',
      clientIp: { trustedProxyHops: 0 },
    })

    const handler = toLambdaHandler(routes.requestMagicLink, {
      corsHeaders: () => {
        return CORS
      },
      clearCookies: auth.clearCookies,
      context: () => {
        return ctx
      },
    })

    const result = await handler({ body: '{"email":"ada@example.com"}' })

    expect(JSON.parse(result.body)).toEqual({ message: 'Check your inbox.' })
    expect(fakes.userStore.findByEmail).toHaveBeenCalledWith('ada@example.com', ctx)
  })
})

describe('extractSourceIp', () => {
  it.each<[{ xff?: string; sourceIp?: string; hops?: number }, string]>([
    [{ xff: '6.6.6.6', sourceIp: '9.9.9.9', hops: 0 }, '9.9.9.9'],
    [{ xff: '6.6.6.6, 1.2.3.4', hops: 1 }, '1.2.3.4'],
    [{ xff: '1.2.3.4', sourceIp: '9.9.9.9', hops: 2 }, '9.9.9.9'],
    [{}, ''],
  ])('%o → %s', ({ xff, sourceIp, hops }, expected) => {
    const event = {
      ...(xff ? { headers: { 'X-Forwarded-For': xff } } : {}),
      ...(sourceIp ? { requestContext: { identity: { sourceIp } } } : {}),
    }

    expect(extractSourceIp(event, hops)).toBe(expected)
  })
})

describe('client IP', () => {
  const XFF_WARNING = 'X-Forwarded-For names a client other than sourceIp; check clientIp.trustedProxyHops'

  const event = (xff: string | undefined, sourceIp: string | undefined) => {
    return {
      body: '{"email":"ada@example.com"}',
      ...(xff ? { headers: { 'X-Forwarded-For': xff } } : {}),
      ...(sourceIp ? { requestContext: { identity: { sourceIp } } } : {}),
    }
  }

  const loggerCtx = () => {
    return { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
  }

  const xffWarnings = (ctx: ReturnType<typeof loggerCtx>) => {
    return ctx.logger.warn.mock.calls.filter(([message]) => {
      return message === XFF_WARNING
    })
  }

  it('keys the per-IP limit on sourceIp whatever X-Forwarded-For claims', async () => {
    const { routes, wrap, fakes } = setup()
    const handler = wrap(routes.requestMagicLink)

    await handler(event('6.6.6.6', '9.9.9.9'))
    await handler(event('7.7.7.7, 8.8.8.8', '9.9.9.9'))

    const ipKeys = fakes.rateLimiter.incrementAndCheck.mock.calls
      .map(([key]) => {
        return key
      })
      .filter((key) => {
        return key.startsWith('magic:ip:')
      })

    expect(ipKeys).toEqual(['magic:ip:9.9.9.9', 'magic:ip:9.9.9.9'])
  })

  it.each([
    ['a client other than sourceIp', '6.6.6.6', '9.9.9.9', 1],
    ['a direct edge-optimized chain', '9.9.9.9, 130.176.0.1', '9.9.9.9', 0],
    ['sourceIp itself', '9.9.9.9', '9.9.9.9', 0],
    ['no header', undefined, '9.9.9.9', 0],
  ])('with 0 hops, warns %s → %i warning(s)', async (_label, xff, sourceIp, warnings) => {
    const { routes } = setup()
    const ctx = loggerCtx()

    await routes.requestMagicLink.handle(event(xff, sourceIp), ctx)

    expect(xffWarnings(ctx)).toHaveLength(warnings)
  })

  it('warns once per routes instance, with no IP in the data', async () => {
    const { routes } = setup()
    const ctx = loggerCtx()

    await routes.requestMagicLink.handle(event('6.6.6.6', '9.9.9.9'), ctx)
    await routes.verifyMagicLink
      .handle({ ...event('5.5.5.5', '9.9.9.9'), queryStringParameters: {} }, ctx)
      .catch(() => {
        return undefined
      })

    expect(xffWarnings(ctx)).toEqual([[XFF_WARNING, { data: { forwardedCount: 1 } }]])
  })

  it('keeps the warning for a later request when the first had no logger', async () => {
    const { routes } = setup()
    const ctx = loggerCtx()

    await routes.requestMagicLink.handle(event('6.6.6.6', '9.9.9.9'), undefined)
    await routes.requestMagicLink.handle(event('6.6.6.6', '9.9.9.9'), ctx)

    expect(xffWarnings(ctx)).toHaveLength(1)
  })

  it('refuses a missing or invalid clientIp at construction', () => {
    const { auth } = setup()

    const corsHeaders = () => {
      return CORS
    }

    expect(() => {
      return createAuthRoutes(
        auth,
        // @ts-expect-error clientIp is required
        { corsHeaders },
      )
    }).toThrow()
    expect(() => {
      return createAuthRoutes(auth, { corsHeaders, clientIp: { trustedProxyHops: -1 } })
    }).toThrow()
    expect(() => {
      return createAuthRoutes(auth, { corsHeaders, clientIp: { trustedProxyHops: 1.5 } })
    }).toThrow()
  })
})
