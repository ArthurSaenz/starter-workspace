import jwt from 'jsonwebtoken'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_SECRET, IDENTITY, createFakes, invitedUser } from '../../__tests__/helpers/fakes.js'
import { createGoogleStub, googleConfig } from '../../__tests__/helpers/google-stub.js'
import { createMagicLinkAuth } from '../../create-auth.js'
import { createAuthHandlers, toLambdaHandler } from '../handler.js'
import { createAuthRoutes } from '../routes.js'
import type { LambdaResult } from '../types.js'

const CORS = { 'Access-Control-Allow-Origin': 'https://app.test', 'Access-Control-Allow-Credentials': 'true' }
const HEADERS = { ...CORS, 'Cache-Control': 'no-store' }
const ERROR_PAGE = 'https://app.test/auth/sign-in'
const IP = '203.0.113.9'

const corsHeaders = () => {
  return CORS
}

const setup = (withGoogle = true) => {
  const fakes = createFakes([invitedUser()])
  const stub = createGoogleStub()
  const auth = createMagicLinkAuth({ ...fakes.config, ...(withGoogle ? { google: googleConfig(stub) } : {}) })
  const options = { corsHeaders, clientIp: { trustedProxyHops: 0 } }
  const handlers = createAuthHandlers(auth, options)

  return { fakes, stub, auth, routes: createAuthRoutes(auth, options), handlers }
}

const cookiePair = (result: LambdaResult): string => {
  return result
    .multiValueHeaders!['Set-Cookie']!.map((cookie) => {
      return cookie.split(';')[0]
    })
    .filter((pair) => {
      return !pair!.endsWith('=')
    })
    .join('; ')
}

const startAndAuthorize = async (
  handlers: ReturnType<typeof setup>['handlers'],
  stub: ReturnType<typeof createGoogleStub>,
  redirect = '/trips',
) => {
  const started = await handlers.googleStart!({ queryStringParameters: { redirect } })
  const { Location: location } = started.headers!
  const code = stub.authorize(location!)
  const state = new URL(location!).searchParams.get('state')!

  return { started, code, state, cookie: started.multiValueHeaders!['Set-Cookie']![0]!.split(';')[0]! }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('google routes', () => {
  it('routes and handlers have no google keys when google is unset', () => {
    const off = setup(false)
    const on = setup()

    expect(Object.keys(off.routes).sort()).toEqual(['logout', 'me', 'refresh', 'requestMagicLink', 'verifyMagicLink'])
    expect(Object.keys(off.handlers).sort()).toEqual(['logout', 'me', 'refresh', 'requestMagicLink', 'verifyMagicLink'])
    expect(Object.keys(on.handlers).sort()).toEqual([
      'googleCallback',
      'googleStart',
      'logout',
      'me',
      'refresh',
      'requestMagicLink',
      'verifyMagicLink',
    ])
    expect(Object.keys(on.routes).sort()).toEqual(Object.keys(on.handlers).sort())
  })

  it('googleStart 302s to Google with a state cookie scoped to the callback path, no-store', async () => {
    const { handlers } = setup()

    for (const queryStringParameters of [{ redirect: '/trips' }, null]) {
      const result = await handlers.googleStart!({ queryStringParameters })
      const { Location: location, ...headers } = result.headers!

      expect(result.statusCode).toBe(302)
      expect(result.body).toBe('')
      expect(headers).toEqual(HEADERS)
      expect(location!.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
      expect(result.multiValueHeaders!['Set-Cookie']).toEqual([
        expect.stringMatching(
          /^__Secure-google_oauth=[\w-]+\.[\w-]+\.[\w-]+; HttpOnly; Secure; SameSite=Lax; Path=\/api\/v1\/auth\/google\/callback; Max-Age=600$/,
        ),
      ])
    }
  })

  it('googleStart answers a no-store 302 to the error page without a cookie when start throws', async () => {
    const { auth, routes } = setup()

    vi.spyOn(auth.google!, 'start').mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await toLambdaHandler(routes.googleStart!, { corsHeaders, clearCookies: auth.clearCookies })({})

    expect(result).toEqual({
      statusCode: 302,
      headers: { ...HEADERS, Location: auth.google!.failureLocation('failed') },
      body: '',
    })
    expect(result.headers).toMatchObject({ Location: `${ERROR_PAGE}?auth_error=failed` })
  })

  it('googleCallback sets both session cookies, clears the state cookie, 302s to the redirect, no-store', async () => {
    const { auth, handlers, stub, fakes } = setup()
    const { code, state, cookie } = await startAndAuthorize(handlers, stub)

    const result = await handlers.googleCallback!({
      queryStringParameters: { code, state, scope: 'email openid', authuser: '0' },
      headers: { cookie, 'User-Agent': 'vitest' },
      requestContext: { identity: { sourceIp: IP } },
    })

    const [access, refresh, clearState] = result.multiValueHeaders!['Set-Cookie']!

    expect(result).toMatchObject({
      statusCode: 302,
      headers: { ...HEADERS, Location: 'https://app.test/trips' },
      body: '',
    })
    expect(access).toMatch(/^access_token=.+; Path=\/; Max-Age=900$/)
    expect(refresh).toMatch(/^refresh_token=.+; Path=\/api\/v1\/auth; Max-Age=604800$/)
    expect(clearState).toBe(auth.google!.clearStateCookie())
    expect(fakes.sessions[0]).toMatchObject({ userId: 'u1', ipAddress: IP, userAgent: 'vitest' })
  })

  it('googleCallback 302s a refused sign-in to the error page and clears the state cookie', async () => {
    const { auth, handlers, stub } = setup()
    const { code, state } = await startAndAuthorize(handlers, stub)

    for (const queryStringParameters of [{ code, state }, null]) {
      const result = await handlers.googleCallback!({ queryStringParameters })

      expect(result).toEqual({
        statusCode: 302,
        headers: { ...HEADERS, Location: `${ERROR_PAGE}?auth_error=invalid_state` },
        multiValueHeaders: { 'Set-Cookie': [auth.google!.clearStateCookie()] },
        body: '',
      })
    }
  })

  it('googleCallback answers a no-store 302 to the error page that clears the state cookie even when the engine throws', async () => {
    const { auth, routes } = setup()
    const google = auth.google!

    const failure = await google.complete({
      query: { code: undefined, state: undefined, error: undefined },
      headers: {},
    })

    vi.spyOn(google, 'complete').mockRejectedValue(new Error('boom'))

    const result = await toLambdaHandler(routes.googleCallback!, { corsHeaders, clearCookies: auth.clearCookies })({
      queryStringParameters: { code: 'c', state: 's' },
    })

    expect(result).toEqual({
      statusCode: 302,
      headers: { ...HEADERS, Location: google.failureLocation('failed') },
      multiValueHeaders: { 'Set-Cookie': [google.clearStateCookie()] },
      body: '',
    })
    expect(result.multiValueHeaders!['Set-Cookie']).toEqual([failure.cookies.at(-1)])
  })

  it('round trip: start, stub Google, callback, me, refresh keeps authMethod google', async () => {
    const { handlers, stub } = setup()
    const { code, state, cookie } = await startAndAuthorize(handlers, stub)

    const callback = await handlers.googleCallback!({ queryStringParameters: { code, state }, headers: { cookie } })

    expect(callback.headers).toMatchObject({ Location: 'https://app.test/trips' })

    const session = cookiePair(callback)
    const me = await handlers.me({ headers: { cookie: session } })

    expect(me.statusCode).toBe(200)
    expect(JSON.parse(me.body)).toEqual({ id: 'u1', email: 'ada@example.com' })

    const refreshed = await handlers.refresh({ headers: { cookie: session } })
    const [access] = refreshed.multiValueHeaders!['Set-Cookie']!
    const payload = jwt.verify(access!.split(';')[0]!.split('=')[1]!, ACCESS_SECRET, IDENTITY) as jwt.JwtPayload

    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.multiValueHeaders!['Set-Cookie']).toHaveLength(2)
    expect(payload).toMatchObject({ sub: 'u1', authMethod: 'google' })
  })
})
