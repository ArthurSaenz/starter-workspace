import type { AuthErrorCode } from './errors.js'
import { defaultCreateAuthError } from './errors.js'
import type { HeaderBag } from './http.js'
import {
  buildClearCookies,
  extractAccessToken,
  extractRefreshToken,
  resolveCookieOptions,
  sanitizeRedirectUrl,
} from './http.js'
import type {
  MagicLinkAuthConfig,
  RequestMagicLinkInput,
  RequestMeta,
  RequestValidationInput,
  TokenPair,
  VerifyMagicLinkInput,
  VerifyMagicLinkResult,
} from './magicLinkConfig.js'
import {
  DEFAULT_INVITE_TOKEN_TTL_MIN,
  DEFAULT_MAGIC_TOKEN_TTL_MIN,
  assertMagicLinkConfig,
  createDefaultVerifyValidator,
  defaultIsAllowed,
  defaultRolesOf,
  defaultValidateRequest,
  isTokenRecordLive,
  resolveRateLimits,
  toMs,
} from './magicLinkConfig.js'
import { createMagicLinkSender } from './magicLinkMail.js'
import type { AuthContext, AuthUser } from './ports.js'
import { createSessionIssuer } from './sessionIssuer.js'
import type { AccessTokenPayload } from './tokens.js'
import {
  DEFAULT_ACCESS_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  hashToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './tokens.js'

export type MagicLinkAuth<TUser extends AuthUser, TMe, TCtx extends AuthContext> = ReturnType<
  typeof createMagicLinkAuth<TUser, TMe, TCtx>
>

export const createMagicLinkAuth = <TUser extends AuthUser, TMe, TCtx extends AuthContext = AuthContext>(
  config: MagicLinkAuthConfig<TUser, TMe, TCtx>,
) => {
  assertMagicLinkConfig(config)

  const { users, magicTokens, sessions, rateLimiter, mailer } = config
  const identity = { issuer: config.jwt.issuer, audience: config.jwt.audience }
  const signInTtlMin = config.magicLink.ttlMin ?? DEFAULT_MAGIC_TOKEN_TTL_MIN
  const inviteTtlMin = config.magicLink.inviteTtlMin ?? DEFAULT_INVITE_TOKEN_TTL_MIN
  const cookies = resolveCookieOptions(config.cookies)
  const maxTokenAgeMs = Math.max(signInTtlMin, inviteTtlMin) * 60 * 1000
  const limits = resolveRateLimits(config.rateLimits)
  const createError = config.createError ?? defaultCreateAuthError
  const notInvitedMessage = config.notInvitedMessage ?? 'This email is not invited.'

  const isAllowed: (user: TUser) => boolean = config.isAllowed ?? defaultIsAllowed
  const rolesOf: (user: TUser) => string[] = config.rolesOf ?? defaultRolesOf

  const fail = (message: string, code: AuthErrorCode, status: number): Error => {
    return createError({ message, code, status })
  }

  const invalidSession = (code: AuthErrorCode = 'INVALID_REFRESH_TOKEN'): Error => {
    return fail('Invalid session', code, 401)
  }

  const validateRequest: (input: RequestValidationInput, ctx?: TCtx) => void =
    config.validate?.requestMagicLink ?? defaultValidateRequest

  const validateVerify = config.validate?.verifyMagicLink ?? createDefaultVerifyValidator(createError)

  const checkRate = async (key: string, limit: number, ctx?: TCtx): Promise<boolean> => {
    const gate = await rateLimiter.incrementAndCheck(`${limits.keyPrefix}:${key}`, limit, limits.windowSec, ctx)

    return gate.allowed
  }

  const mintAndSendMagicLink = createMagicLinkSender<TCtx>({
    magicTokens,
    mailer,
    email: config.email,
    renderEmail: config.renderEmail,
    magicLink: config.magicLink,
    signInTtlMin,
    inviteTtlMin,
  })

  const issuer = createSessionIssuer<TUser, TCtx>({
    accessSecret: config.jwt.accessSecret,
    refreshSecret: config.jwt.refreshSecret,
    identity,
    accessTtlSec: config.jwt.accessTtlSec ?? DEFAULT_ACCESS_TTL_SEC,
    refreshTtlSec: config.jwt.refreshTtlSec ?? DEFAULT_REFRESH_TTL_SEC,
    sessions,
    cookies,
    rolesOf,
    createError,
  })

  const loadUser = async (userId: string, ctx?: TCtx): Promise<TUser> => {
    const user = await users.findById(userId, ctx)

    if (!user) throw fail('User not found', 'USER_NOT_FOUND', 401)

    return user
  }

  const requireUser = (headers: HeaderBag): AccessTokenPayload => {
    const token = extractAccessToken(headers, cookies.accessName)

    if (!token) throw fail('Missing access token', 'UNAUTHENTICATED', 401)

    return verifyAccessToken(token, config.jwt.accessSecret, identity, createError)
  }

  return {
    cookies,
    identity,
    uninvitedRequest: config.uninvitedRequest ?? 'silent',

    async requestMagicLink(input: RequestMagicLinkInput, ctx?: TCtx): Promise<void> {
      const email = (input.email || '').trim().toLowerCase()

      try {
        validateRequest({ email, redirectUrl: input.redirectUrl }, ctx)
      } catch (validationError) {
        ctx?.logger?.info('Magic link request rejected by validation; answering the generic OK', {
          data: { reason: (validationError as Error).name },
        })

        return
      }

      const redirectUrl = sanitizeRedirectUrl(input.redirectUrl)
      const emailAllowed = await checkRate(`email:${email}`, limits.perEmail, ctx)
      // A missing IP shares one bucket rather than skipping the per-IP limit.
      const ipAllowed = await checkRate(`ip:${input.ipAddress || 'unknown'}`, limits.perIp, ctx)

      if (!emailAllowed || !ipAllowed) {
        ctx?.logger?.warn('Magic link rate limit exceeded', { data: { emailAllowed, ipAllowed } })

        return
      }

      // Never create a user here: an address that is not already allowed gets no row, no token and
      // no email. Creating on request is how an invite-only surface ends up open to the internet.
      const user = await users.findByEmail(email, ctx)

      if (!user || !isAllowed(user)) {
        ctx?.logger?.warn('Magic link requested by an address that may not sign in', {
          data: { exists: Boolean(user) },
        })

        if (config.uninvitedRequest === 'reject') throw fail(notInvitedMessage, 'NOT_INVITED', 403)

        return
      }

      await mintAndSendMagicLink(email, redirectUrl, input, 'sign-in', ctx)
    },

    /**
     * Email a sign-in link on an admin's behalf: no rate limit and no allowlist check, because the
     * caller has just authorised this address. Uses the longer invite TTL. `emailSent: false` means
     * the mailer or template failed and the link is already dead: tell the admin, do not say "sent".
     */
    async sendInviteLink(email: string, ctx?: TCtx): Promise<{ emailSent: boolean }> {
      const to = (email || '').trim().toLowerCase()
      const emailSent = await mintAndSendMagicLink(to, sanitizeRedirectUrl(undefined), {}, 'invite', ctx)

      return { emailSent }
    },

    async verifyMagicLink(input: VerifyMagicLinkInput, ctx?: TCtx): Promise<VerifyMagicLinkResult> {
      validateVerify({ rawToken: input.rawToken }, ctx)

      if (!(await checkRate(`verify:ip:${input.ipAddress || 'unknown'}`, limits.perIpVerify, ctx))) {
        ctx?.logger?.warn('Magic link verify rate limit exceeded', { data: { ipAddress: input.ipAddress } })
        throw fail('Too many requests', 'RATE_LIMITED', 429)
      }

      const record = await magicTokens.consumeByHash(hashToken(input.rawToken), ctx)

      if (!record) throw fail('Invalid or expired token', 'INVALID_OR_EXPIRED_TOKEN', 401)

      if (!isTokenRecordLive(record, maxTokenAgeMs)) {
        throw fail('Invalid or expired token', 'INVALID_OR_EXPIRED_TOKEN', 401)
      }

      // The allowlist may have been revoked between request and verify.
      const user = await users.findByEmail(record.email, ctx)

      if (!user || !isAllowed(user)) {
        ctx?.logger?.warn('Magic link verify rejected: address may not sign in', {
          data: { exists: Boolean(user) },
        })
        throw fail(notInvitedMessage, 'NOT_INVITED', 403)
      }

      await config.onSignIn?.(user, ctx)

      const pair = await issuer.issue(user, input, ctx)

      return { ...pair, redirectUrl: sanitizeRedirectUrl(record.redirectUrl) }
    },

    async refreshSession(refreshToken: string, ctx?: TCtx, meta?: RequestMeta): Promise<TokenPair> {
      if (!refreshToken) throw invalidSession('UNAUTHENTICATED')

      if (!(await checkRate(`refresh:ip:${meta?.ipAddress || 'unknown'}`, limits.perIpRefresh, ctx))) {
        ctx?.logger?.warn('Refresh rate limit exceeded', { data: { ipAddress: meta?.ipAddress } })
        throw fail('Too many requests', 'RATE_LIMITED', 429)
      }

      const payload = verifyRefreshToken(refreshToken, config.jwt.refreshSecret, identity, createError)
      const session = await sessions.findByTokenHash(hashToken(refreshToken), ctx)

      if (!session) throw invalidSession()

      if (session.revokedAt) {
        ctx?.logger?.warn('Refresh token reuse detected; revoking every session of the user', {
          data: { userId: session.userId },
        })
        await sessions.revokeAllForUser(session.userId, ctx)

        throw invalidSession()
      }

      if (toMs(session.expiresAt) < Date.now()) throw invalidSession()

      const user = await users.findById(payload.sub, ctx)

      if (!user) throw invalidSession('USER_NOT_FOUND')

      // Refresh is where a long-lived session re-earns its right to exist, so a revoked invite must
      // end it here. Revoke every session: the siblings would walk straight back in on their next rotation.
      if (!isAllowed(user)) {
        ctx?.logger?.warn('Refresh by a user who may no longer sign in; revoking every session', {
          data: { userId: String(user.id) },
        })
        await sessions.revokeAllForUser(String(user.id), ctx)

        throw fail(notInvitedMessage, 'NOT_INVITED', 403)
      }

      return issuer.rotate(session, user, ctx)
    },

    async logout(refreshToken: string | null, ctx?: TCtx): Promise<void> {
      if (!refreshToken) return

      try {
        await sessions.revokeByTokenHash(hashToken(refreshToken), ctx)
      } catch (error) {
        ctx?.logger?.warn('Failed to revoke session on logout', { data: { name: (error as Error).name } })
      }
    },

    /** The verified access-token payload, or UNAUTHENTICATED / INVALID_ACCESS_TOKEN (401). */
    requireUser,

    /** `requireUser` plus the freshly loaded row: authorise from this, so a revoke applies on the next request. */
    async authenticate(headers: HeaderBag, ctx?: TCtx): Promise<{ payload: AccessTokenPayload; user: TUser }> {
      const payload = requireUser(headers)

      return { payload, user: await loadUser(payload.sub, ctx) }
    },

    async getMe(payload: AccessTokenPayload, ctx?: TCtx): Promise<TMe> {
      return config.toMe(await loadUser(payload.sub, ctx))
    },

    issueSession: issuer.issue,

    extractAccessToken(headers: HeaderBag): string | null {
      return extractAccessToken(headers, cookies.accessName)
    },

    extractRefreshToken(headers: HeaderBag): string | null {
      return extractRefreshToken(headers, cookies.refreshName)
    },

    clearCookies(): string[] {
      return buildClearCookies(cookies)
    },
  }
}
