import jwt from 'jsonwebtoken'
import { generateKeyPairSync } from 'node:crypto'
import { vi } from 'vitest'

import type { GoogleSignInConfig } from '../../google/config.js'
import type { TestUser } from './fakes.js'

export const CLIENT_ID = 'client-123.apps.googleusercontent.com'
export const CLIENT_SECRET = 'google-client-secret'
export const REDIRECT_URI = 'https://app.test/api/v1/auth/google/callback'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

export interface RecordedRequest {
  url: string
  init: RequestInit | undefined
}

export interface SignOptions {
  /** `null` leaves `kid` out of the header. */
  kid?: string | null
  noTimestamp?: boolean
}

const newKey = (kid: string) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

  return { kid, privateKey, publicKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } }
}

/**
 * A stand-in for Google's token and JWKS endpoints, injected as `google.fetch`. `authorize` plays the
 * consent screen: it mints a code whose ID token carries the start URL's nonce.
 */
export const createGoogleStub = () => {
  let signingKey = newKey('kid-1')
  let publishedKeys = [signingKey]
  const codes = new Map<string, string>()
  const requests: RecordedRequest[] = []
  let nextCode = 1

  const stub = {
    requests,
    /** Replace to answer an endpoint differently; `defaultToken` / `defaultJwks` are the real behaviour. */
    tokenResponse: undefined as ((body: URLSearchParams) => Promise<Response>) | undefined,
    jwksResponse: undefined as (() => Promise<Response>) | undefined,
    jwksCacheControl: 'public, max-age=21600, must-revalidate, no-transform' as string | null,

    /** The signing key's public half as PEM, for the HS256 key-confusion attack. */
    publicKeyPem: () => {
      return signingKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    },

    /** Starts signing with a new `kid`; `publish: false` keeps it out of the JWKS. */
    rotateKey: (kid: string, { publish = true } = {}) => {
      signingKey = newKey(kid)
      if (publish) publishedKeys = [...publishedKeys, signingKey]
    },

    signIdToken: (claims: Record<string, unknown>, options: SignOptions = {}) => {
      const now = Math.floor(Date.now() / 1000)

      // A claim set to `undefined` is left out of the token.
      const payload = JSON.parse(
        JSON.stringify({
          iss: 'https://accounts.google.com',
          aud: CLIENT_ID,
          sub: '110169484474386276334',
          email: 'ada@example.com',
          email_verified: true,
          hd: 'example.com',
          ...(options.noTimestamp ? {} : { iat: now }),
          exp: now + 3600,
          ...claims,
        }),
      ) as Record<string, unknown>

      return jwt.sign(payload, signingKey.privateKey, {
        algorithm: 'RS256',
        // jsonwebtoken keeps a payload `iat` unless told `noTimestamp`, which deletes it.
        noTimestamp: options.noTimestamp === true,
        ...(options.kid === null ? {} : { keyid: options.kid ?? signingKey.kid }),
      })
    },

    /** The consent screen: a code for an ID token bound to the start URL's nonce. */
    authorize: (startLocation: string, claims: Record<string, unknown> = {}, options: SignOptions = {}) => {
      const nonce = new URL(startLocation).searchParams.get('nonce')
      const code = `code-${nextCode++}`

      codes.set(code, stub.signIdToken({ nonce, ...claims }, options))

      return code
    },

    defaultToken: async (body: URLSearchParams): Promise<Response> => {
      const idToken = codes.get(body.get('code') ?? '')

      if (!idToken) return Response.json({ error: 'invalid_grant' }, { status: 400 })

      return Response.json({ access_token: 'ya29.access', expires_in: 3599, token_type: 'Bearer', id_token: idToken })
    },

    defaultJwks: async (): Promise<Response> => {
      return Response.json(
        {
          keys: publishedKeys.map((key) => {
            return key.jwk
          }),
        },
        { headers: stub.jwksCacheControl ? { 'cache-control': stub.jwksCacheControl } : {} },
      )
    },

    jwksFetches: () => {
      return requests.filter((request) => {
        return request.url === JWKS_URL
      }).length
    },

    tokenRequests: () => {
      return requests.filter((request) => {
        return request.url === TOKEN_URL
      })
    },

    fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input)

      requests.push({ url, init })

      if (url === JWKS_URL) return (stub.jwksResponse ?? stub.defaultJwks)()

      if (url === TOKEN_URL) {
        const body = new URLSearchParams(String(init?.body))

        return (stub.tokenResponse ?? stub.defaultToken)(body)
      }

      throw new Error(`unexpected fetch ${url}`)
    }),
  }

  return stub
}

export const googleConfig = (
  stub: ReturnType<typeof createGoogleStub>,
  overrides: Partial<GoogleSignInConfig<TestUser, object>> = {},
): GoogleSignInConfig<TestUser, object> => {
  return {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    fetch: stub.fetch,
    ...overrides,
  }
}
