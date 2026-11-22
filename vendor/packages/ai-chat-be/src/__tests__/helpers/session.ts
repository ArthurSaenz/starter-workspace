import jwt from 'jsonwebtoken'

// Mirrors `signAccessToken` in apps/client/api/src/services/auth/auth.service.ts — the token
// the browser carries in the `access_token` cookie.
export const TEST_JWT_SECRET = 'test-customer-jwt-secret-at-least-32-chars-long'
export const TEST_CUSTOMER_ID = 'cust-42'

type ExpiresIn = Exclude<jwt.SignOptions['expiresIn'], undefined>

interface SignOverrides {
  secret?: string
  sub?: string
  issuer?: string
  audience?: string
  expiresIn?: ExpiresIn
}

export const signAccessToken = (overrides: SignOverrides = {}): string => {
  const payload = { sub: overrides.sub ?? TEST_CUSTOMER_ID, roles: ['user'], authMethod: 'magic_link' }

  return jwt.sign(payload, overrides.secret ?? TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: overrides.expiresIn ?? '15m',
    issuer: overrides.issuer ?? 'nomadream-client-api',
    audience: overrides.audience ?? 'nomadream-client',
  })
}

/** The `cookie` header a signed-in browser sends on a same-origin runtime request. */
export const sessionCookie = (token = signAccessToken()): string => {
  return `access_token=${token}`
}
