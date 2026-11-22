import jwt from 'jsonwebtoken'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

import type { JwtIdentity } from '../tokens.js'
import type { GoogleFailureStep } from './config.js'

export const STATE_COOKIE_NAME = '__Secure-google_oauth'
export const STATE_TTL_SEC = 600

const STATE_TYP = 'google-state'

/** What travels from start to callback: `state`, `nonce`, PKCE verifier, sanitised redirect. */
export interface GoogleState {
  s: string
  n: string
  v: string
  r: string
}

export type StateCheck =
  { ok: true; state: GoogleState } | { ok: false; step: Extract<GoogleFailureStep, 'bad-signature' | 'expired'> }

// A key of its own, so no access token can pass as a state cookie or the reverse. `hkdfSync` returns
// an ArrayBuffer, which jsonwebtoken v9 does not take as an HS256 secret.
export const createStateKey = (accessSecret: string): crypto.KeyObject => {
  return crypto.createSecretKey(Buffer.from(crypto.hkdfSync('sha256', accessSecret, '', 'wl-auth/google-state', 32)))
}

export const signState = (key: crypto.KeyObject, state: GoogleState, identity: JwtIdentity): string => {
  return jwt.sign({ ...state, typ: STATE_TYP }, key, {
    algorithm: 'HS256',
    expiresIn: STATE_TTL_SEC,
    issuer: identity.issuer,
    audience: identity.audience,
  })
}

export const verifyState = (key: crypto.KeyObject, token: string, identity: JwtIdentity): StateCheck => {
  let claims: Record<string, unknown>

  try {
    // The issuer/audience options make jsonwebtoken refuse a non-object payload, so this is an object.
    claims = jwt.verify(token, key, {
      algorithms: ['HS256'],
      issuer: identity.issuer,
      audience: identity.audience,
    }) as jwt.JwtPayload
  } catch (error) {
    // jsonwebtoken checks the signature before `exp`, so an expired state is still an authentic one.
    return { ok: false, step: error instanceof jwt.TokenExpiredError ? 'expired' : 'bad-signature' }
  }

  const { s, n, v, r, typ } = claims

  if (
    typ !== STATE_TYP ||
    typeof s !== 'string' ||
    typeof n !== 'string' ||
    typeof v !== 'string' ||
    typeof r !== 'string'
  ) {
    return { ok: false, step: 'bad-signature' }
  }

  return { ok: true, state: { s, n, v, r } }
}

/** `__Secure-` keeps a non-secure origin from planting it; `__Host-` would force `Path=/`. */
export const buildStateCookie = (path: string, value: string, maxAgeSec: number): string => {
  return `${STATE_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAgeSec}`
}
