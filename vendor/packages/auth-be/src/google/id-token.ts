import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

import { errorName } from '../errors.js'
import type { AuthLogger } from '../ports.js'
import type { GoogleFailureStep, GoogleIdentity } from './config.js'
import { GOOGLE_ISSUERS, GOOGLE_JWKS_URI, GOOGLE_TIMEOUT_MS } from './config.js'

const DEFAULT_JWKS_MAX_AGE_SEC = 3600
const REFETCH_WINDOW_MS = 60 * 1000
const CLOCK_TOLERANCE_SEC = 30

export type IdTokenCheck =
  { ok: true; identity: GoogleIdentity } | { ok: false; step: Extract<GoogleFailureStep, 'jwks' | 'id-token'> }

const maxAgeMs = (cacheControl: string | null): number => {
  return Number(/max-age=(\d+)/i.exec(cacheControl ?? '')?.[1] ?? DEFAULT_JWKS_MAX_AGE_SEC) * 1000
}

const parseJwks = (body: unknown): Map<string, crypto.KeyObject> => {
  const keys: unknown = typeof body === 'object' && body !== null && 'keys' in body ? body.keys : undefined

  if (!Array.isArray(keys)) throw new TypeError('JWKS has no keys array')

  return new Map(
    keys.flatMap((jwk: crypto.webcrypto.JsonWebKey & { kid?: unknown }) => {
      const { kid } = jwk

      return typeof kid === 'string' ? [[kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })] as const] : []
    }),
  )
}

/**
 * `kid → KeyObject` for the life of the container, refetched on `max-age` and, rate-bounded, on an
 * unknown `kid` or after a failed fetch.
 */
const createJwksCache = (fetchImpl: typeof fetch) => {
  let keys = new Map<string, crypto.KeyObject>()
  let expiresAt = 0
  let unknownKidRefetchAt = Number.NEGATIVE_INFINITY

  const refresh = async (logger: AuthLogger | undefined): Promise<void> => {
    const fetchedAt = Date.now()

    try {
      const response = await fetchImpl(GOOGLE_JWKS_URI, { signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) })

      if (!response.ok) throw new Error(`JWKS answered ${response.status}`)

      keys = parseJwks(await response.json())
      expiresAt = fetchedAt + maxAgeMs(response.headers.get('cache-control'))
      logger?.info('Google JWKS refreshed', { data: { keyCount: keys.size } })
    } catch (error) {
      // The cached keys keep serving until a fetch succeeds. That fails closed: Google lists a key
      // before signing with it, so a stale cache only misses a newer kid. A key Google has since
      // withdrawn stays trusted meanwhile, but ID tokens come only from the token endpoint over TLS.
      expiresAt = fetchedAt + REFETCH_WINDOW_MS
      unknownKidRefetchAt = fetchedAt
      logger?.warn('Google JWKS refresh failed', { data: { name: errorName(error), cachedKeyCount: keys.size } })
    }
  }

  return async (kid: string, logger: AuthLogger | undefined): Promise<crypto.KeyObject | undefined> => {
    const now = Date.now()

    if (now >= expiresAt) {
      await refresh(logger)
    } else if (!keys.has(kid) && now - unknownKidRefetchAt >= REFETCH_WINDOW_MS) {
      // A key Google rotated in since our fetch. Stamped before the fetch, so a stream of forged
      // kids costs one fetch per window rather than one per request.
      unknownKidRefetchAt = now
      await refresh(logger)
    }

    return keys.get(kid)
  }
}

// Called on a payload `jwt.verify` accepted: signature, `iss`, `aud`, `nonce`, `exp` and `nbf` hold.
const toIdentity = (claims: Record<string, unknown>): GoogleIdentity | null => {
  const { sub, email, email_verified: emailVerified, hd, iat, exp } = claims

  // jsonwebtoken checks neither a missing `exp` nor a future `iat`.
  if (typeof exp !== 'number' || typeof iat !== 'number' || iat > Date.now() / 1000 + CLOCK_TOLERANCE_SEC) return null

  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email) return null

  const hostedDomain = typeof hd === 'string' && hd ? hd.toLowerCase() : null

  return {
    sub,
    email,
    emailVerified: emailVerified === true || emailVerified === 'true',
    emailAuthoritative: email.toLowerCase().endsWith('@gmail.com') || hostedDomain !== null,
    hostedDomain,
  }
}

/**
 * Verifies an ID token from the token endpoint against Google's JWKS: RS256 only. Never fed a token
 * that came through the browser.
 */
export const createIdTokenVerifier = (options: { clientId: string; fetch: typeof fetch }) => {
  const keyFor = createJwksCache(options.fetch)

  const lookupKey = async (kid: unknown, logger: AuthLogger | undefined): Promise<crypto.KeyObject | undefined> => {
    if (typeof kid !== 'string' || !kid) return undefined

    return keyFor(kid, logger)
  }

  return async (idToken: string, nonce: string, logger?: AuthLogger): Promise<IdTokenCheck> => {
    const decoded = jwt.decode(idToken, { complete: true })

    // Before the key lookup, so `alg: none` or an HS256 token is an id-token failure, not a JWKS one.
    if (decoded?.header.alg !== 'RS256') return { ok: false, step: 'id-token' }

    const key = await lookupKey(decoded.header.kid, logger)

    if (!key) return { ok: false, step: 'jwks' }

    let claims: Record<string, unknown>

    try {
      // The audience/issuer options make jsonwebtoken refuse a non-object payload, so this is an object.
      claims = jwt.verify(idToken, key, {
        algorithms: ['RS256'],
        audience: options.clientId,
        issuer: GOOGLE_ISSUERS,
        nonce,
        clockTolerance: CLOCK_TOLERANCE_SEC,
      }) as jwt.JwtPayload
    } catch {
      return { ok: false, step: 'id-token' }
    }

    const identity = toIdentity(claims)

    return identity ? { ok: true, identity } : { ok: false, step: 'id-token' }
  }
}
