import type { AuthContext, AuthUser } from '../ports.js'
import type { RateLimitConfig } from '../rate-limit.js'
import { assertRateLimits } from '../rate-limit.js'
import type { RequestMeta, TokenPair } from '../session/types.js'
import { assertSecret } from '../tokens.js'
import type { MagicLinkEmailText, RenderMagicLinkEmail } from './email.js'

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

/** The keys `assertMagicLinkConfig` reads; `MagicLinkAuthConfig` is assignable to it. */
export interface MagicLinkConfigShape<TCtx extends AuthContext> {
  jwt: {
    accessSecret: string
    refreshSecret: string
    accessTtlSec?: number
    refreshTtlSec?: number
    refreshGraceSec?: number
  }
  magicLink: { baseUrl: string; ttlMin?: number; inviteTtlMin?: number }
  rateLimits?: Partial<RateLimitConfig>
  minResponseMs?: number
  email?: MagicLinkEmailText
  renderEmail?: RenderMagicLinkEmail<TCtx>
}

export const defaultIsAllowed = (user: AuthUser): boolean => {
  return user.invited === true
}

export const defaultRolesOf = (user: AuthUser): string[] => {
  return user.roles ?? []
}

export const assertMagicLinkConfig = <TCtx extends AuthContext>(config: MagicLinkConfigShape<TCtx>): void => {
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

  assertRateLimits(config.rateLimits)

  if (config.minResponseMs !== undefined && !(Number.isFinite(config.minResponseMs) && config.minResponseMs >= 0)) {
    throw new Error('auth: minResponseMs must be a non-negative number')
  }

  if (!config.email === !config.renderEmail) {
    throw new Error('auth: pass exactly one of email or renderEmail')
  }
}
