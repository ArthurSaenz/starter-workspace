import { sanitizeRedirectUrl } from '../http/redirect.js'
import type { AuthContext, AuthUser } from '../ports.js'

/** The ID token's claims as the engine reads them, after signature and claim checks. */
export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  /** Google vouches for who owns this address: a `@gmail.com` address, or one with an `hd` claim. */
  emailAuthoritative: boolean
  hostedDomain: string | null
}

/** The closed list of `auth_error` values a failed sign-in lands on the SPA with. */
export type GoogleSignInError = 'cancelled' | 'invalid_state' | 'not_allowed' | 'rate_limited' | 'failed'

/** Where a sign-in failed, for the `Google sign-in failed` log. Internal: not exported from the package. */
export type GoogleFailureStep =
  | 'missing-cookie'
  | 'bad-signature'
  | 'expired'
  | 'mismatch'
  | 'provider-error'
  | 'rate-limit'
  | 'token-exchange'
  | 'jwks'
  | 'id-token'
  | 'email'
  | 'hosted-domain'
  | 'user'
  | 'store'

export interface GoogleSignInConfig<TUser extends AuthUser, TCtx extends AuthContext> {
  clientId: string
  clientSecret: string
  /** Absolute URL of the callback route, registered verbatim in the Google console. */
  redirectUri: string
  /** Staff tools: the ID token's `hd` must be one of these (lower-cased). Always enforced. */
  hostedDomains?: string[]
  /** SPA path a failed sign-in lands on with `?auth_error=`; default '/auth/sign-in'. */
  errorPath?: string
  /**
   * Replaces the default email match, and its answer is final: null/undefined refuses, with no
   * email fallback. Runs after `email_verified` and `hostedDomains`; `isAllowed` still applies.
   * Link by `identity.sub` here; accepting `emailAuthoritative: false` is the host's risk.
   */
  resolveUser?: (identity: GoogleIdentity, ctx?: TCtx) => Promise<TUser | null | undefined>
  fetch?: typeof fetch
}

// Endpoints from https://accounts.google.com/.well-known/openid-configuration
export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_ISSUERS: [string, string] = ['https://accounts.google.com', 'accounts.google.com']

export const GOOGLE_TIMEOUT_MS = 5000
export const DEFAULT_GOOGLE_ERROR_PATH = '/auth/sign-in'

const isLocalHost = (hostname: string): boolean => {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
}

const assertRedirectUri = (redirectUri: string, baseUrl: string): void => {
  let url: URL

  try {
    url = new URL(redirectUri)
  } catch {
    throw new Error('auth: google.redirectUri must be an absolute URL')
  }

  if (redirectUri.includes('#')) {
    throw new Error('auth: google.redirectUri must not carry a fragment')
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error('auth: google.redirectUri must be https (http only on localhost)')
  }

  // The callback sets the session cookies, so it must answer on the origin the SPA reads them from.
  if (url.origin !== new URL(baseUrl).origin) {
    throw new Error('auth: google.redirectUri must be on the same origin as magicLink.baseUrl')
  }
}

/** `baseUrl` is the normalised `magicLink.baseUrl`, already checked by `assertMagicLinkConfig`. */
export const assertGoogleConfig = <TUser extends AuthUser, TCtx extends AuthContext>(
  google: GoogleSignInConfig<TUser, TCtx>,
  baseUrl: string,
): void => {
  if (!google.clientId) {
    throw new Error('auth: google.clientId is required')
  }

  if (!google.clientSecret) {
    throw new Error('auth: google.clientSecret is required')
  }

  assertRedirectUri(google.redirectUri, baseUrl)

  const errorPath = google.errorPath ?? DEFAULT_GOOGLE_ERROR_PATH

  if (sanitizeRedirectUrl(errorPath) !== errorPath) {
    throw new Error('auth: google.errorPath must be an in-app path')
  }

  // A failure redirect appends `?auth_error=…` to it.
  if (/[?#]/.test(errorPath)) {
    throw new Error('auth: google.errorPath must not carry a query or fragment')
  }

  const { hostedDomains } = google

  // An empty list would refuse every sign-in, which is a config mistake, not a policy.
  if (
    hostedDomains !== undefined &&
    !(
      Array.isArray(hostedDomains) &&
      hostedDomains.length > 0 &&
      hostedDomains.every((domain) => {
        return typeof domain === 'string' && domain.length > 0
      })
    )
  ) {
    throw new Error('auth: google.hostedDomains must be a non-empty list of non-empty strings')
  }
}
