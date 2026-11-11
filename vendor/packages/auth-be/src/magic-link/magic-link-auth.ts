import type { AuthErrorCode } from '../errors.js'
import { defaultCreateAuthError, errorName } from '../errors.js'
import { resolveCookieOptions } from '../http/cookies.js'
import { sanitizeRedirectUrl } from '../http/redirect.js'
import type { AuthContext, AuthUser } from '../ports.js'
import { createRateGate, ipBucket, resolveRateLimits } from '../rate-limit.js'
import { createSessionService } from '../session/session-service.js'
import { DEFAULT_ACCESS_TTL_SEC, DEFAULT_REFRESH_GRACE_SEC, DEFAULT_REFRESH_TTL_SEC, hashToken } from '../tokens.js'
import type {
  MagicLinkAuthConfig,
  RequestMagicLinkInput,
  VerifyMagicLinkInput,
  VerifyMagicLinkResult,
} from './config.js'
import {
  DEFAULT_INVITE_TOKEN_TTL_MIN,
  DEFAULT_MAGIC_TOKEN_TTL_MIN,
  assertMagicLinkConfig,
  defaultIsAllowed,
  defaultRolesOf,
} from './config.js'
import { createMagicLinkSender } from './sender.js'
import type { RequestValidationInput } from './validation.js'
import { createDefaultVerifyValidator, defaultValidateRequest, isTokenRecordLive } from './validation.js'

export type MagicLinkAuth<TUser extends AuthUser, TMe, TCtx extends AuthContext> = ReturnType<
  typeof createMagicLinkAuth<TUser, TMe, TCtx>
>

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) return

  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * The engine: the magic-link sign-in (request, invite, verify) on top of the session service
 * (refresh, logout, the request readers), wired from one host config.
 */
export const createMagicLinkAuth = <TUser extends AuthUser, TMe, TCtx extends AuthContext = AuthContext>(
  config: MagicLinkAuthConfig<TUser, TMe, TCtx>,
) => {
  assertMagicLinkConfig(config)

  const { users, magicTokens } = config
  const identity = { issuer: config.jwt.issuer, audience: config.jwt.audience }
  const cookies = resolveCookieOptions(config.cookies)
  const signInTtlMin = config.magicLink.ttlMin ?? DEFAULT_MAGIC_TOKEN_TTL_MIN
  const inviteTtlMin = config.magicLink.inviteTtlMin ?? DEFAULT_INVITE_TOKEN_TTL_MIN
  const maxTokenAgeMs = Math.max(signInTtlMin, inviteTtlMin) * 60 * 1000
  const limits = resolveRateLimits(config.rateLimits)
  const checkRate = createRateGate(config.rateLimiter, limits)
  const createError = config.createError ?? defaultCreateAuthError
  const notInvitedMessage = config.notInvitedMessage ?? 'This email is not invited.'
  const uninvitedRequest = config.uninvitedRequest ?? 'silent'
  const minResponseMs = config.minResponseMs ?? 0
  const isAllowed: (user: TUser) => boolean = config.isAllowed ?? defaultIsAllowed

  const validateRequest: (input: RequestValidationInput, ctx?: TCtx) => void =
    config.validate?.requestMagicLink ?? defaultValidateRequest

  const validateVerify = config.validate?.verifyMagicLink ?? createDefaultVerifyValidator(createError)

  const fail = (message: string, code: AuthErrorCode, status: number): Error => {
    return createError({ message, code, status })
  }

  const { baseUrl } = config.magicLink

  const sendMagicLink = createMagicLinkSender<TCtx>({
    magicTokens,
    mailer: config.mailer,
    email: config.email,
    renderEmail: config.renderEmail,
    // `https://app.test/` + `/auth/verify` would mail a `//auth/verify` link no SPA route matches.
    magicLink: { ...config.magicLink, baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl },
    signInTtlMin,
    inviteTtlMin,
  })

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

  const handleLinkRequest = async (input: RequestMagicLinkInput, ctx?: TCtx): Promise<void> => {
    const email = (input.email || '').trim().toLowerCase()

    try {
      validateRequest({ email, redirectUrl: input.redirectUrl }, ctx)
    } catch (validationError) {
      ctx?.logger?.info('Magic link request rejected by validation; answering the generic OK', {
        data: { reason: errorName(validationError) },
      })

      return
    }

    const redirectUrl = sanitizeRedirectUrl(input.redirectUrl)
    const emailAllowed = await checkRate(`email:${email}`, limits.perEmail, ctx)
    const ipAllowed = await checkRate(`ip:${ipBucket(input.ipAddress)}`, limits.perIp, ctx)

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

      if (uninvitedRequest === 'reject') throw fail(notInvitedMessage, 'NOT_INVITED', 403)

      return
    }

    await sendMagicLink(email, redirectUrl, input, 'sign-in', ctx)
  }

  /** Answers the same for every outcome unless the host chose `uninvitedRequest: 'reject'`. */
  const requestMagicLink = async (input: RequestMagicLinkInput, ctx?: TCtx): Promise<void> => {
    const startedAt = Date.now()

    try {
      return await handleLinkRequest(input, ctx)
    } finally {
      await delay(minResponseMs - (Date.now() - startedAt))
    }
  }

  /**
   * Email a sign-in link on an admin's behalf: no rate limit and no allowlist check, because the
   * caller has just authorised this address. Uses the longer invite TTL. `emailSent: false` means
   * the mailer or template failed and the link is already dead: tell the admin, do not say "sent".
   */
  const sendInviteLink = async (email: string, ctx?: TCtx): Promise<{ emailSent: boolean }> => {
    const to = (email || '').trim().toLowerCase()

    if (!to) return { emailSent: false }

    const emailSent = await sendMagicLink(to, sanitizeRedirectUrl(undefined), {}, 'invite', ctx)

    return { emailSent }
  }

  const verifyMagicLink = async (input: VerifyMagicLinkInput, ctx?: TCtx): Promise<VerifyMagicLinkResult> => {
    validateVerify({ rawToken: input.rawToken }, ctx)

    if (!(await checkRate(`verify:ip:${ipBucket(input.ipAddress)}`, limits.perIpVerify, ctx))) {
      ctx?.logger?.warn('Magic link verify rate limit exceeded', { data: { ipAddress: input.ipAddress } })
      throw fail('Too many requests', 'RATE_LIMITED', 429)
    }

    const tokenHash = hashToken(input.rawToken)
    const record = await magicTokens.consumeByHash(tokenHash, ctx)

    if (!record || !isTokenRecordLive(record, maxTokenAgeMs)) {
      throw fail('Invalid or expired token', 'INVALID_OR_EXPIRED_TOKEN', 401)
    }

    // Consume-then-release keeps the link single-use under concurrency (the store settles who
    // consumed it) while an outage after the consume does not burn the user's only link.
    const releaseOnFailure = async <T>(step: () => Promise<T>): Promise<T> => {
      try {
        return await step()
      } catch (error) {
        try {
          await magicTokens.release(tokenHash, record, ctx)
        } catch (releaseError) {
          ctx?.logger?.error('Failed to release the magic token after a failed sign-in', {
            data: { name: errorName(releaseError) },
          })
        }

        throw error
      }
    }

    // The allowlist may have been revoked between request and verify.
    const user = await releaseOnFailure(() => {
      return users.findByEmail(record.email, ctx)
    })

    if (!user || !isAllowed(user)) {
      ctx?.logger?.warn('Magic link verify rejected: address may not sign in', {
        data: { exists: Boolean(user) },
      })
      throw fail(notInvitedMessage, 'NOT_INVITED', 403)
    }

    const pair = await releaseOnFailure(async () => {
      await config.onSignIn?.(user, ctx)

      return session.issueSession(user, input, ctx)
    })

    return { ...pair, redirectUrl: sanitizeRedirectUrl(record.redirectUrl) }
  }

  return {
    cookies,
    identity,
    uninvitedRequest,
    requestMagicLink,
    sendInviteLink,
    verifyMagicLink,
    ...session,
  }
}
