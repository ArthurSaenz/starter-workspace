import { describe, expect, it } from 'vitest'

import { createFakes, invitedUser, tokenFromEmail } from '../../__tests__/helpers/fakes.js'
import { createAuthHandlers, createMagicLinkAuth } from '../../index.js'
import type { LambdaResult } from '../../index.js'

// Imports only the public barrel and the fakes, so moving internal files cannot change this file.

const CORS = { 'Access-Control-Allow-Origin': 'https://app.test', 'Access-Control-Allow-Credentials': 'true' }
const HEADERS = { ...CORS, 'Cache-Control': 'no-store' }

const ACCESS_COOKIE = 'access_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900'
const REFRESH_COOKIE = 'refresh_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=604800'

const CLEAR_COOKIES = [
  'access_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
  'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=0',
]

const normalise = (result: LambdaResult) => {
  const { statusCode, headers, multiValueHeaders, body } = result
  const raw = JSON.stringify({ statusCode, headers, multiValueHeaders, body })

  return JSON.parse(raw.replaceAll(/eyJ[\w-]*\.[\w-]*\.[\w-]*/g, '<jwt>')) as Record<string, unknown>
}

const setup = () => {
  const fakes = createFakes([invitedUser()])
  const auth = createMagicLinkAuth(fakes.config)

  const handlers = createAuthHandlers(auth, {
    corsHeaders: () => {
      return CORS
    },
    clientIp: { trustedProxyHops: 0 },
  })

  return { fakes, handlers }
}

const signedIn = async () => {
  const ctx = setup()
  const requested = await ctx.handlers.requestMagicLink({ body: '{"email":"ada@example.com"}' })

  const verified = await ctx.handlers.verifyMagicLink({
    queryStringParameters: { token: tokenFromEmail(ctx.fakes.sent[0]!) },
  })

  const [accessCookie, refreshCookie] = verified.multiValueHeaders!['Set-Cookie']!
  const cookie = `${accessCookie!.split(';')[0]}; ${refreshCookie!.split(';')[0]}`

  return { ...ctx, requested, verified, cookie }
}

describe('golden route responses', () => {
  it('requestMagicLink', async () => {
    const { requested } = await signedIn()

    expect(normalise(requested)).toEqual({
      statusCode: 200,
      headers: HEADERS,
      body: '{"message":"If that email exists, a sign-in link has been sent."}',
    })
  })

  it('verifyMagicLink', async () => {
    const { verified } = await signedIn()

    expect(normalise(verified)).toEqual({
      statusCode: 200,
      headers: HEADERS,
      multiValueHeaders: { 'Set-Cookie': [ACCESS_COOKIE, REFRESH_COOKIE] },
      body: '{"ok":true,"redirect":"/"}',
    })
  })

  it('refresh', async () => {
    const { handlers, cookie } = await signedIn()

    expect(normalise(await handlers.refresh({ headers: { cookie } }))).toEqual({
      statusCode: 200,
      headers: HEADERS,
      multiValueHeaders: { 'Set-Cookie': [ACCESS_COOKIE, REFRESH_COOKIE] },
      body: '{"ok":true}',
    })
  })

  it('logout', async () => {
    const { handlers, cookie } = await signedIn()

    expect(normalise(await handlers.logout({ headers: { cookie } }))).toEqual({
      statusCode: 204,
      headers: HEADERS,
      multiValueHeaders: { 'Set-Cookie': CLEAR_COOKIES },
      body: '',
    })
  })

  it('me', async () => {
    const { handlers, cookie } = await signedIn()

    expect(normalise(await handlers.me({ headers: { cookie } }))).toEqual({
      statusCode: 200,
      headers: HEADERS,
      body: '{"id":"u1","email":"ada@example.com"}',
    })
  })
})

describe('golden error envelopes', () => {
  it('401 on me, without clearing cookies', async () => {
    const { handlers } = setup()

    expect(normalise(await handlers.me({}))).toEqual({
      statusCode: 401,
      headers: HEADERS,
      body: '{"type":"UNAUTHENTICATED","message":"Missing access token"}',
    })
  })

  it('401 on refresh, clearing cookies', async () => {
    const { handlers } = setup()

    expect(normalise(await handlers.refresh({}))).toEqual({
      statusCode: 401,
      headers: HEADERS,
      multiValueHeaders: { 'Set-Cookie': CLEAR_COOKIES },
      body: '{"type":"UNAUTHENTICATED","message":"Invalid session"}',
    })
  })

  it('403 NOT_INVITED on me for a de-invited user', async () => {
    const { handlers, cookie, fakes } = await signedIn()

    fakes.users.get('u1')!.invited = false

    expect(normalise(await handlers.me({ headers: { cookie } }))).toEqual({
      statusCode: 403,
      headers: HEADERS,
      body: '{"type":"NOT_INVITED","message":"This email is not invited."}',
    })
  })

  it('429 on verifyMagicLink', async () => {
    const { handlers, fakes } = setup()

    fakes.rateLimiter.limitOverride = 0

    expect(normalise(await handlers.verifyMagicLink({ queryStringParameters: { token: 'ab'.repeat(32) } }))).toEqual({
      statusCode: 429,
      headers: HEADERS,
      body: '{"type":"RATE_LIMITED","message":"Too many requests"}',
    })
  })

  it('500 on me when the user store fails', async () => {
    const { handlers, cookie, fakes } = await signedIn()

    fakes.userStore.findById.mockRejectedValueOnce(new Error('db down'))

    expect(normalise(await handlers.me({ headers: { cookie } }))).toEqual({
      statusCode: 500,
      headers: HEADERS,
      body: '{"type":"INTERNAL_ERROR","message":"Internal error"}',
    })
  })
})
