import type { CreateAuthError } from './errors.js'
import type { GoogleSignInConfig } from './google/config.js'
import type { CookieOptions } from './http/cookies.js'
import type { MagicLinkEmailText, RenderMagicLinkEmail } from './magic-link/email.js'
import type { RequestValidationInput } from './magic-link/validation.js'
import type { AuthContext, AuthUser, MagicTokenStore, Mailer, RateLimiter, SessionStore, UserStore } from './ports.js'
import type { RateLimitConfig } from './rate-limit.js'
import type { JwtIdentity } from './tokens.js'

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
  /** Enables Google sign-in on the same users, allowlist, sessions and rate gate; absent, `auth.google` is too. */
  google?: GoogleSignInConfig<TUser, TCtx>
}
