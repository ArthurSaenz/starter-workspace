import type { MagicLinkAuthConfig } from './auth-config.js'
import { defaultCreateAuthError } from './errors.js'
import { assertGoogleConfig } from './google/config.js'
import { createGoogleSignIn } from './google/google-sign-in.js'
import { resolveCookieOptions } from './http/cookies.js'
import { assertMagicLinkConfig, defaultIsAllowed, defaultRolesOf } from './magic-link/config.js'
import { createMagicLinkFlows } from './magic-link/magic-link-flows.js'
import type { AuthContext, AuthUser } from './ports.js'
import { createRateGate, resolveRateLimits } from './rate-limit.js'
import { createSessionService } from './session/session-service.js'
import { DEFAULT_ACCESS_TTL_SEC, DEFAULT_REFRESH_GRACE_SEC, DEFAULT_REFRESH_TTL_SEC } from './tokens.js'

export type MagicLinkAuth<TUser extends AuthUser, TMe, TCtx extends AuthContext> = ReturnType<
  typeof createMagicLinkAuth<TUser, TMe, TCtx>
>

/**
 * The engine: the magic-link sign-in (request, invite, verify) and, when configured, Google, on
 * top of the session service (refresh, logout, the request readers), wired from one host config.
 */
export const createMagicLinkAuth = <TUser extends AuthUser, TMe, TCtx extends AuthContext = AuthContext>(
  config: MagicLinkAuthConfig<TUser, TMe, TCtx>,
) => {
  assertMagicLinkConfig(config)

  const { users } = config
  const identity = { issuer: config.jwt.issuer, audience: config.jwt.audience }
  const cookies = resolveCookieOptions(config.cookies)
  const limits = resolveRateLimits(config.rateLimits)
  const checkRate = createRateGate(config.rateLimiter, limits)
  const createError = config.createError ?? defaultCreateAuthError
  const notInvitedMessage = config.notInvitedMessage ?? 'This email is not invited.'
  const uninvitedRequest = config.uninvitedRequest ?? 'silent'
  const isAllowed: (user: TUser) => boolean = config.isAllowed ?? defaultIsAllowed

  const { baseUrl: rawBaseUrl } = config.magicLink
  // `https://app.test/` + `/auth/verify` would mail a `//auth/verify` link no SPA route matches.
  const baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl

  if (config.google) assertGoogleConfig(config.google, baseUrl)

  const session = createSessionService<TUser, TMe, TCtx>({
    users,
    sessions: config.sessions,
    accessSecret: config.jwt.accessSecret,
    refreshSecret: config.jwt.refreshSecret,
    identity,
    accessTtlSec: config.jwt.accessTtlSec ?? DEFAULT_ACCESS_TTL_SEC,
    refreshTtlSec: config.jwt.refreshTtlSec ?? DEFAULT_REFRESH_TTL_SEC,
    refreshGraceSec: config.jwt.refreshGraceSec ?? DEFAULT_REFRESH_GRACE_SEC,
    cookies,
    isAllowed,
    rolesOf: config.rolesOf ?? defaultRolesOf,
    toMe: config.toMe,
    checkRate,
    refreshLimit: limits.perIpRefresh,
    createError,
    notInvitedMessage,
  })

  const magicLink = createMagicLinkFlows<TUser, TCtx>({
    users,
    magicTokens: config.magicTokens,
    mailer: config.mailer,
    email: config.email,
    renderEmail: config.renderEmail,
    magicLink: { ...config.magicLink, baseUrl },
    checkRate,
    limits,
    issueSession: session.issueSession,
    isAllowed,
    createError,
    notInvitedMessage,
    uninvitedRequest,
    minResponseMs: config.minResponseMs ?? 0,
    onSignIn: config.onSignIn,
    validate: config.validate,
  })

  return {
    cookies,
    identity,
    uninvitedRequest,
    ...magicLink,
    ...session,
    ...(config.google
      ? {
          google: createGoogleSignIn<TUser, TCtx>({
            google: config.google,
            baseUrl,
            identity,
            accessSecret: config.jwt.accessSecret,
            users,
            isAllowed,
            checkRate,
            verifyLimit: limits.perIpVerify,
            issueSession: session.issueSession,
            onSignIn: config.onSignIn,
          }),
        }
      : {}),
  }
}
