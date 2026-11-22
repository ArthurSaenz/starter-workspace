import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLIENT_ID, createGoogleStub } from '../../__tests__/helpers/google-stub.js'
import { createIdTokenVerifier } from '../id-token.js'

const NONCE = 'nonce-1'

const setup = () => {
  const stub = createGoogleStub()
  const verify = createIdTokenVerifier({ clientId: CLIENT_ID, fetch: stub.fetch })

  return { stub, verify }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('verifyGoogleIdToken', () => {
  it('reads the identity off a valid token', async () => {
    const { stub, verify } = setup()

    await expect(verify(stub.signIdToken({ nonce: NONCE }), NONCE)).resolves.toEqual({
      ok: true,
      identity: {
        sub: '110169484474386276334',
        email: 'ada@example.com',
        emailVerified: true,
        emailAuthoritative: true,
        hostedDomain: 'example.com',
      },
    })
  })

  it('refuses a token that does not decode', async () => {
    const { stub, verify } = setup()

    await expect(verify('not-a-jwt', NONCE)).resolves.toEqual({ ok: false, step: 'id-token' })
    expect(stub.jwksFetches()).toBe(0)
  })

  it.each([
    ['no exp', { exp: undefined }, {}],
    ['no iat', {}, { noTimestamp: true }],
    ['no sub', { sub: undefined }, {}],
    ['an empty sub', { sub: '' }, {}],
    ['no email', { email: undefined }, {}],
  ])('refuses a token with %s', async (_label, claims, options) => {
    const { stub, verify } = setup()

    await expect(verify(stub.signIdToken({ nonce: NONCE, ...claims }, options), NONCE)).resolves.toEqual({
      ok: false,
      step: 'id-token',
    })
  })

  it('reads an empty hd as no hosted domain', async () => {
    const { stub, verify } = setup()

    await expect(verify(stub.signIdToken({ nonce: NONCE, hd: '' }), NONCE)).resolves.toMatchObject({
      identity: { hostedDomain: null, emailAuthoritative: false },
    })
  })

  it('skips a JWK without a kid', async () => {
    const { stub, verify } = setup()
    const token = stub.signIdToken({ nonce: NONCE })

    stub.jwksResponse = async () => {
      const served = await stub.defaultJwks()
      const { keys } = (await served.json()) as { keys: object[] }

      return Response.json({ keys: [{ kty: 'RSA', n: 'AQAB', e: 'AQAB' }, ...keys] })
    }

    await expect(verify(token, NONCE)).resolves.toMatchObject({ ok: true })
  })

  it('refetches after max-age, 3600 s by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const { stub, verify } = setup()

    stub.jwksCacheControl = null

    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    vi.setSystemTime(Date.now() + 3599 * 1000)
    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    expect(stub.jwksFetches()).toBe(1)

    vi.setSystemTime(Date.now() + 2 * 1000)
    stub.jwksCacheControl = 'no-cache'
    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    expect(stub.jwksFetches()).toBe(2)

    vi.setSystemTime(Date.now() + 3601 * 1000)
    stub.jwksCacheControl = 'public, max-age=60'
    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    vi.setSystemTime(Date.now() + 61 * 1000)
    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    expect(stub.jwksFetches()).toBe(4)
  })

  it('looks for an unknown kid again only once 60 s have passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const { stub, verify } = setup()

    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    stub.rotateKey('kid-later', { publish: false })

    await expect(verify(stub.signIdToken({ nonce: NONCE }), NONCE)).resolves.toEqual({ ok: false, step: 'jwks' })
    vi.setSystemTime(Date.now() + 59 * 1000)
    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    expect(stub.jwksFetches()).toBe(2)

    vi.setSystemTime(Date.now() + 2 * 1000)
    await verify(stub.signIdToken({ nonce: NONCE }), NONCE)
    expect(stub.jwksFetches()).toBe(3)
  })
})
