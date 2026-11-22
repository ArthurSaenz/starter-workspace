/* eslint-disable node/prefer-global/process */
import type { HeaderBag } from '@wl/auth-be'
import { extractAccessToken as extractToken, verifySession } from '@wl/auth-be'

// The chat runtime answers only a signed-in traveller: the endpoint is otherwise anonymous,
// unrate-limited and backed by a paid model key. The session is the `access_token` cookie the host's
// sign-in mints; the host passes that sign-in's issuer and audience, and a drift between the two
// rejects every chat request with a 401.

/** The `iss` / `aud` pair the access token must carry. */
export interface CustomerSessionIdentity {
  issuer: string
  audience: string
}

export interface CustomerSession {
  /** The customer id (`sub` of the access token). */
  customerId: string
}

// Cookie first (the browser path); a bearer header is accepted for server-side callers and tests.
export const extractAccessToken = (headers: HeaderBag): string | undefined => {
  return extractToken(headers) ?? undefined
}

// Fails CLOSED: no (or a too-short) secret configured ⇒ nobody is signed in, whatever the request carries.
export const verifyCustomerSession = (
  headers: HeaderBag,
  identity: CustomerSessionIdentity,
): CustomerSession | null => {
  const payload = verifySession(headers, {
    issuer: identity.issuer,
    audience: identity.audience,
    // eslint-disable-next-line dot-notation
    accessSecret: process.env['CUSTOMER_JWT_ACCESS_SECRET'],
  })

  return payload ? { customerId: payload.sub } : null
}
