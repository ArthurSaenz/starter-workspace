import type { CreateAuthError } from '../errors.js'
import type { CookieOptions } from '../http/cookies.js'
import type { AuthContext, AuthUser, MagicTokenStore, Mailer, RateLimiter, SessionStore, UserStore } from '../ports.js'
import type { RateLimitConfig } from '../rate-limit.js'
import type { RequestMeta, TokenPair } from '../session/types.js'
import type { JwtIdentity } from '../tokens.js'
import { assertSecret } from '../tokens.js'
import type { MagicLinkEmailText, RenderMagicLinkEmail } from './email.js'
import type { RequestValidationInput } from './validation.js'

export const DEFAULT_MAGIC_TOKEN_TTL_MIN = 15
// An invite can sit unread for days while a sign-in link is clicked seconds after it is requested;
// 72 h covers "saw it after the weekend", and re-inviting invalidates the old link.
export const DEFAULT_INVITE_TOKEN_TTL_MIN = 72 * 60

export interface RequestMagicLinkInput extends RequestMeta {
  email: string
  redirectUrl?: string
}

export interface VerifyMagicLinkInput extends RequestMeta {
  rawToken: string
}

export interface VerifyMagicLinkResult extends TokenPair {
  redirectUrl: string
}

export interface MagicLinkAuthConfig<TUser extends AuthUser, TMe, TCtx extends AuthContext> {
  users: UserStore<TUser, TCtx>
  magicTokens: MagicTokenStore<TCtx>
  sessions: SessionStore<TCtx>
  rateLimiter: RateLimiter<TCtx>
  mailer: Mailer<TCtx>
  /**
   * `refreshGraceSec` (default 30, 0 disables): how long a just-rotated refresh token still earns an
   * access token for its successor instead of tripping reuse detection, so a second tab's refresh
   * does not log the user out. A thief replaying inside it gets one access token, not a session.
   */
  jwt: JwtIdentity & {
    accessSecret: string
    refreshSecret: string
    accessTtlSec?: number
    refreshTtlSec?: number
    refreshGraceSec?: number
  }
  /** `baseUrl` is the SPA origin; the emailed link is `${baseUrl}${verifyPath}?token=…`. */
  magicLink: { baseUrl: string; verifyPath?: string; ttlMin?: number; inviteTtlMin?: number }
  /** Exactly one of `email` (the built-in plain template's copy) and `renderEmail` is required. */
  email?: MagicLinkEmailText
  renderEmail?: RenderMagicLinkEmail<TCtx>
  /** The DTO `GET /auth/me` answers with. */
  toMe: (user: TUser) => TMe
  cookies?: CookieOptions
  rateLimits?: Partial<RateLimitConfig>
  /**
   * What a link request from an address that may not sign in gets. `silent` (default) answers like a
   * success, so the body is no membership oracle (the timing is, unless `minResponseMs` covers it);
   * `reject` throws NOT_INVITED (403) for an internal tool whose invited users need the feedback.
   */
  uninvitedRequest?: 'silent' | 'reject'
  /**
   * Floor on how long `requestMagicLink` takes, whatever the outcome, so a known address does not
   * answer slower than an unknown one. Set it above the mail path's p99; 0 (default) adds nothing.
   */
  minResponseMs?: number
  /** The allowlist; re-asked at request, verify AND refresh so a revoke ends running sessions. */
  isAllowed?: (user: TUser) => boolean
  /** Copied into the access token. Informational: authorise from the loaded row, not from the claim. */
  rolesOf?: (user: TUser) => string[]
  /** Side effects of a successful sign-in (mark the email verified, record the login…). */
  onSignIn?: (user: TUser, ctx?: TCtx) => Promise<void>
  /** Throw to reject. A rejected link request still answers like a success (anti-enumeration). */
  validate?: {
    requestMagicLink?: (input: RequestValidationInput, ctx?: TCtx) => void
    verifyMagicLink?: (input: { rawToken: string }, ctx?: TCtx) => void
  }
  createError?: CreateAuthError
  notInvitedMessage?: string
}

export const defaultIsAllowed = (user: AuthUser): boolean => {
  return user.invited === true
}

export const defaultRolesOf = (user: AuthUser): string[] => {
  return user.roles ?? []
}

export const assertMagicLinkConfig = <TUser extends AuthUser, TMe, TCtx extends AuthContext>(
  config: MagicLinkAuthConfig<TUser, TMe, TCtx>,
): void => {
  assertSecret('jwt.accessSecret', config.jwt.accessSecret)
  assertSecret('jwt.refreshSecret', config.jwt.refreshSecret)

  if (config.jwt.accessSecret === config.jwt.refreshSecret) {
    throw new Error('auth: jwt.accessSecret and jwt.refreshSecret must differ')
  }

  if (!config.magicLink.baseUrl) {
    throw new Error('auth: magicLink.baseUrl is required')
  }

  if (!/^https?:\/\/[^/]/i.test(config.magicLink.baseUrl)) {
    throw new Error('auth: magicLink.baseUrl must be an absolute http(s) URL')
  }

  // A bad TTL would otherwise surface only after verify has spent the link (jwt.sign throws on NaN).
  const ttls = {
    'jwt.accessTtlSec': config.jwt.accessTtlSec,
    'jwt.refreshTtlSec': config.jwt.refreshTtlSec,
    'magicLink.ttlMin': config.magicLink.ttlMin,
    'magicLink.inviteTtlMin': config.magicLink.inviteTtlMin,
  }

  for (const [name, ttl] of Object.entries(ttls)) {
    if (ttl !== undefined && !(Number.isInteger(ttl) && ttl > 0)) {
      throw new Error(`auth: ${name} must be a positive integer`)
    }
  }

  const grace = config.jwt.refreshGraceSec

  if (grace !== undefined && !(Number.isInteger(grace) && grace >= 0)) {
    throw new Error('auth: jwt.refreshGraceSec must be a non-negative integer')
  }

  if (config.minResponseMs !== undefined && !(Number.isFinite(config.minResponseMs) && config.minResponseMs >= 0)) {
    throw new Error('auth: minResponseMs must be a non-negative number')
  }

  if (!config.email === !config.renderEmail) {
    throw new Error('auth: pass exactly one of email or renderEmail')
  }
}
