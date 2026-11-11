import type { AuthContext, RateLimiter } from './ports.js'

export interface RateLimitConfig {
  perEmail: number
  perIp: number
  perIpVerify: number
  perIpRefresh: number
  windowSec: number
  /** Key namespace in the limiter's store; two apps sharing one store and one prefix share budgets. */
  keyPrefix: string
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

/** Checked at construction like the TTLs: a NaN or 0 budget would refuse every request, as if rate-limited. */
export const assertRateLimits = (overrides: Partial<RateLimitConfig> = {}): void => {
  const { keyPrefix, ...budgets } = overrides

  for (const [name, value] of Object.entries(budgets)) {
    if (value !== undefined && !(Number.isInteger(value) && value > 0)) {
      throw new Error(`auth: rateLimits.${name} must be a positive integer`)
    }
  }

  if (keyPrefix !== undefined && !(typeof keyPrefix === 'string' && keyPrefix)) {
    throw new Error('auth: rateLimits.keyPrefix must be a non-empty string')
  }
}

/** A missing IP shares one bucket rather than skipping the per-IP limit. */
export const ipBucket = (ipAddress: string | undefined): string => {
  return ipAddress || 'unknown'
}

/** Counts one hit against `key`; `false` once it is over `limit` for the window. */
export type RateGate<TCtx extends AuthContext> = (key: string, limit: number, ctx?: TCtx) => Promise<boolean>

export const createRateGate = <TCtx extends AuthContext>(
  rateLimiter: RateLimiter<TCtx>,
  limits: RateLimitConfig,
): RateGate<TCtx> => {
  return async (key, limit, ctx) => {
    const gate = await rateLimiter.incrementAndCheck(`${limits.keyPrefix}:${key}`, limit, limits.windowSec, ctx)

    return gate.allowed
  }
}
