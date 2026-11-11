import { describe, expect, it, vi } from 'vitest'

import { createFakes, invitedUser, tokenFromEmail } from '../../__tests__/helpers/fakes.js'
import { createMagicLinkAuth } from '../../magic-link/magic-link-auth.js'
import { createAuthHandlers } from '../handler.js'

const CORS = { 'Access-Control-Allow-Origin': 'https://app.test' }

const setup = (options: Partial<Parameters<typeof createAuthHandlers>[1]> = {}) => {
  const fakes = createFakes([invitedUser()])
  const auth = createMagicLinkAuth(fakes.config)

  const handlers = createAuthHandlers(auth, {
    corsHeaders: () => {
      return CORS
    },
    clientIp: { trustedProxyHops: 0 },
    ...options,
  })

  return { fakes, handlers }
}

describe('createAuthHandlers', () => {
  it('serves the whole sign-in round trip from one call', async () => {
    const { fakes, handlers } = setup()

    expect(Object.keys(handlers).sort()).toEqual(['logout', 'me', 'refresh', 'requestMagicLink', 'verifyMagicLink'])

    const requested = await handlers.requestMagicLink({ body: '{"email":"ada@example.com","redirectUrl":"/trips"}' })

    expect(requested).toMatchObject({ statusCode: 200, headers: CORS })

    const verified = await handlers.verifyMagicLink({
      queryStringParameters: { token: tokenFromEmail(fakes.sent[0]!) },
    })

    expect(JSON.parse(verified.body)).toEqual({ ok: true, redirect: '/trips' })

    const [accessCookie, refreshCookie] = verified.multiValueHeaders!['Set-Cookie']!
    const cookie = `${accessCookie!.split(';')[0]}; ${refreshCookie!.split(';')[0]}`

    expect(JSON.parse((await handlers.me({ headers: { cookie } })).body)).toEqual({
      id: 'u1',
      email: 'ada@example.com',
    })
    expect((await handlers.refresh({ headers: { cookie } })).statusCode).toBe(200)
    expect((await handlers.logout({ headers: { cookie } })).statusCode).toBe(204)
  })

  it('maps an engine error to its envelope, and clears the cookies on a refresh 401', async () => {
    const { handlers } = setup()

    const me = await handlers.me({})
    const refresh = await handlers.refresh({})

    expect(me).toMatchObject({ statusCode: 401, headers: CORS })
    expect(JSON.parse(me.body)).toEqual({ type: 'UNAUTHENTICATED', message: 'Missing access token' })
    expect(me.multiValueHeaders).toBeUndefined()
    expect(refresh.statusCode).toBe(401)
    expect(refresh.multiValueHeaders!['Set-Cookie']).toEqual([
      'access_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=0',
    ])
  })

  it('passes the host context, error mapping and error hook through', async () => {
    const ctx = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
    const onError = vi.fn()

    const { fakes, handlers } = setup({
      context: () => {
        return ctx
      },
      onError,
      toErrorResponse: () => {
        return { statusCode: 418, body: { type: 'HOST' } }
      },
    })

    await handlers.requestMagicLink({ body: '{"email":"ada@example.com"}' })

    expect(fakes.userStore.findByEmail).toHaveBeenCalledWith('ada@example.com', ctx)
    expect(await handlers.me({})).toMatchObject({ statusCode: 418, body: '{"type":"HOST"}' })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('answers the real error when onError throws', async () => {
    const { handlers } = setup({
      onError: () => {
        throw new Error('hook broke')
      },
    })

    const me = await handlers.me({})

    expect(me).toMatchObject({ statusCode: 401, headers: CORS })
    expect(JSON.parse(me.body)).toMatchObject({ type: 'UNAUTHENTICATED' })
  })

  it('answers the real error, with no unhandled rejection, when an async onError rejects', async () => {
    const unhandled = vi.fn()

    process.on('unhandledRejection', unhandled)

    try {
      const { handlers } = setup({
        onError: async () => {
          throw new Error('hook broke')
        },
      })

      const me = await handlers.me({})

      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(me).toMatchObject({ statusCode: 401, headers: CORS })
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('answers the real response, without CORS headers, when corsHeaders throws', async () => {
    const onError = vi.fn()

    const { fakes, handlers } = setup({
      corsHeaders: () => {
        throw new Error('cors broke')
      },
      onError,
    })

    await handlers.requestMagicLink({ body: '{"email":"ada@example.com"}' })

    const verified = await handlers.verifyMagicLink({
      queryStringParameters: { token: tokenFromEmail(fakes.sent[0]!) },
    })

    expect(verified).toMatchObject({ statusCode: 200, headers: {} })
    expect(verified.multiValueHeaders!['Set-Cookie']).toHaveLength(2)
    expect(await handlers.me({})).toMatchObject({ statusCode: 401, headers: {} })
    expect(await handlers.logout({})).toMatchObject({ statusCode: 204, headers: {} })
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
