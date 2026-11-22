import type { AuthErrorCode, CreateAuthError } from '../errors.js'
import { errorName } from '../errors.js'
import { sanitizeRedirectUrl } from '../http/redirect.js'
import type { AuthContext, AuthUser, MagicTokenStore, Mailer, UserStore } from '../ports.js'
import type { RateGate, RateLimitConfig } from '../rate-limit.js'
import { ipBucket } from '../rate-limit.js'
import type { RequestMeta, TokenPair } from '../session/types.js'
import { hashToken } from '../tokens.js'
import type { RequestMagicLinkInput, VerifyMagicLinkInput, VerifyMagicLinkResult } from './config.js'
import { DEFAULT_INVITE_TOKEN_TTL_MIN, DEFAULT_MAGIC_TOKEN_TTL_MIN } from './config.js'
import type { MagicLinkEmailText, RenderMagicLinkEmail } from './email.js'
import { createMagicLinkSender } from './sender.js'
import type { RequestValidationInput } from './validation.js'
import { createDefaultVerifyValidator, defaultValidateRequest, isTokenRecordLive } from './validation.js'

export interface MagicLinkFlowsDeps<TUser extends AuthUser, TCtx extends AuthContext> {
  users: UserStore<TUser, TCtx>
  magicTokens: MagicTokenStore<TCtx>
  mailer: Mailer<TCtx>
  email: MagicLinkEmailText | undefined
  renderEmail: RenderMagicLinkEmail<TCtx> | undefined
  /** `baseUrl` arrives normalised (no trailing `/`). */
  magicLink: { baseUrl: string; verifyPath?: string; ttlMin?: number; inviteTtlMin?: number }
  checkRate: RateGate<TCtx>
  limits: RateLimitConfig
  issueSession: (user: TUser, meta?: RequestMeta, ctx?: TCtx) => Promise<TokenPair>
  isAllowed: (user: TUser) => boolean
  createError: CreateAuthError
  notInvitedMessage: string
  uninvitedRequest: 'silent' | 'reject'
  minResponseMs: number
  onSignIn: ((user: TUser, ctx?: TCtx) => Promise<void>) | undefined
  validate:
    | {
        requestMagicLink?: (input: RequestValidationInput, ctx?: TCtx) => void
        verifyMagicLink?: (input: { rawToken: string }, ctx?: TCtx) => void
      }
    | undefined
}

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) return

  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** The magic-link sign-in: request, invite and verify; the session it opens comes from `issueSession`. */
export const createMagicLinkFlows = <TUser extends AuthUser, TCtx extends AuthContext>(
  deps: MagicLinkFlowsDeps<TUser, TCtx>,
) => {
  const { users, magicTokens, checkRate, limits, isAllowed, createError, notInvitedMessage } = deps
  const signInTtlMin = deps.magicLink.ttlMin ?? DEFAULT_MAGIC_TOKEN_TTL_MIN
  const inviteTtlMin = deps.magicLink.inviteTtlMin ?? DEFAULT_INVITE_TOKEN_TTL_MIN
  const maxTokenAgeMs = Math.max(signInTtlMin, inviteTtlMin) * 60 * 1000

  const validateRequest: (input: RequestValidationInput, ctx?: TCtx) => void =
    deps.validate?.requestMagicLink ?? defaultValidateRequest

  const validateVerify = deps.validate?.verifyMagicLink ?? createDefaultVerifyValidator(createError)

  const fail = (message: string, code: AuthErrorCode, status: number): Error => {
    return createError({ message, code, status })
  }

  const sendMagicLink = createMagicLinkSender<TCtx>({
    magicTokens,
    mailer: deps.mailer,
    email: deps.email,
    renderEmail: deps.renderEmail,
    magicLink: deps.magicLink,
    signInTtlMin,
    inviteTtlMin,
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

      if (deps.uninvitedRequest === 'reject') throw fail(notInvitedMessage, 'NOT_INVITED', 403)

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
      await delay(deps.minResponseMs - (Date.now() - startedAt))
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
      await deps.onSignIn?.(user, ctx)

      return deps.issueSession(user, input, ctx)
    })

    return { ...pair, redirectUrl: sanitizeRedirectUrl(record.redirectUrl) }
  }

  return { requestMagicLink, sendInviteLink, verifyMagicLink }
}
