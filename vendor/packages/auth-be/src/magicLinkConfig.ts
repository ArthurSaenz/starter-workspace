import type { MagicLinkEmailText, RenderMagicLinkEmail } from './email.js'
import type { CreateAuthError } from './errors.js'
import type { CookieOptions } from './http.js'
import { hasUnsafeRedirectChars } from './http.js'
import type {
  AuthContext,
  AuthUser,
  MagicTokenStore,
  Mailer,
  RateLimiter,
  SessionStore,
  StoredMagicToken,
  UserStore,
} from './ports.js'
import type { JwtIdentity } from './tokens.js'
import { assertSecret } from './tokens.js'

export const DEFAULT_MAGIC_TOKEN_TTL_MIN = 15
// An invite can sit unread for days while a sign-in link is clicked seconds after it is requested;
// 72 h covers "saw it after the weekend", and re-inviting invalidates the old link.
export const DEFAULT_INVITE_TOKEN_TTL_MIN = 72 * 60

export interface RateLimitConfig {
  perEmail: number
  perIp: number
  perIpVerify: number
  perIpRefresh: number
  windowSec: number
  /** Key namespace in the limiter's store; two apps sharing one store and one prefix share budgets. */
  keyPrefix: string
}

export interface RequestMeta {
  ipAddress?: string
  userAgent?: string
}

export interface RequestMagicLinkInput extends RequestMeta {
  email: string
  redirectUrl?: string
}

export interface VerifyMagicLinkInput extends RequestMeta {
  rawToken: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  accessCookie: string
  refreshCookie: string
}

export interface VerifyMagicLinkResult extends TokenPair {
  redirectUrl: string
}

export interface RequestValidationInput {
  email: string
  redirectUrl: string | undefined
}

export interface MagicLinkAuthConfig<TUser extends AuthUser, TMe, TCtx extends AuthContext> {
  users: UserStore<TUser, TCtx>
  magicTokens: MagicTokenStore<TCtx>
  sessions: SessionStore<TCtx>
  rateLimiter: RateLimiter<TCtx>
  mailer: Mailer<TCtx>
  jwt: JwtIdentity & { accessSecret: string; refreshSecret: string; accessTtlSec?: number; refreshTtlSec?: number }
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
   * success, so the body is no membership oracle (the timing still is; see the readme's "Timing");
   * `reject` throws NOT_INVITED (403) for an internal tool whose invited users need the feedback.
   */
  uninvitedRequest?: 'silent' | 'reject'
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

const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  perEmail: 5,
  perIp: 20,
  perIpVerify: 30,
  perIpRefresh: 60,
  windowSec: 3600,
  keyPrefix: 'magic',
}

/** Per key, so an explicit `undefined` override keeps the default instead of disabling the limit. */
export const resolveRateLimits = (overrides: Partial<RateLimitConfig> = {}): RateLimitConfig => {
  return {
    perEmail: overrides.perEmail ?? DEFAULT_RATE_LIMITS.perEmail,
    perIp: overrides.perIp ?? DEFAULT_RATE_LIMITS.perIp,
    perIpVerify: overrides.perIpVerify ?? DEFAULT_RATE_LIMITS.perIpVerify,
    perIpRefresh: overrides.perIpRefresh ?? DEFAULT_RATE_LIMITS.perIpRefresh,
    windowSec: overrides.windowSec ?? DEFAULT_RATE_LIMITS.windowSec,
    keyPrefix: overrides.keyPrefix ?? DEFAULT_RATE_LIMITS.keyPrefix,
  }
}

export const withMeta = (meta: { ipAddress?: string | null; userAgent?: string | null } | undefined): RequestMeta => {
  return {
    ...(meta?.ipAddress ? { ipAddress: meta.ipAddress } : {}),
    ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const TOKEN_REGEX = /^[a-f0-9]{16,256}$/i

export const defaultValidateRequest = (input: RequestValidationInput): void => {
  if (input.email.length > 320 || !EMAIL_REGEX.test(input.email)) throw new Error('Invalid email')

  if (input.redirectUrl && (input.redirectUrl.length > 2048 || hasUnsafeRedirectChars(input.redirectUrl))) {
    throw new Error('Invalid redirectUrl')
  }
}

export const createDefaultVerifyValidator = (createError: CreateAuthError) => {
  return (input: { rawToken: string }): void => {
    if (!TOKEN_REGEX.test(input.rawToken)) {
      throw createError({ message: 'rawToken must be hex', code: 'INVALID_REQUEST', status: 400 })
    }
  }
}

export const toMs = (value: Date | string): number => {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/**
 * `consumeByHash` should already skip expired rows; this re-check uses the token's own expiry (so a
 * 72 h invite is honoured) and treats an unparseable timestamp as expired, never as "no expiry".
 * Two hosts sharing one token table would otherwise honour each other's TTLs (a 72 h staff invite
 * redeemed at a 15-minute traveller surface), so no token outlives `maxTokenAgeMs` either.
 */
export const isTokenRecordLive = (record: StoredMagicToken, maxTokenAgeMs: number): boolean => {
  const now = Date.now()
  const expiresAtMs = toMs(record.expiresAt)

  if (!Number.isFinite(expiresAtMs) || now > expiresAtMs) return false

  if (record.createdAt === undefined) return true

  const createdAtMs = toMs(record.createdAt)

  return Number.isFinite(createdAtMs) && now - createdAtMs <= maxTokenAgeMs
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

  if (!config.email === !config.renderEmail) {
    throw new Error('auth: pass exactly one of email or renderEmail')
  }
}
