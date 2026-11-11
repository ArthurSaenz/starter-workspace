import type { AuthErrorCode, CreateAuthError } from '../errors.js'
import { errorName } from '../errors.js'
import type { ResolvedCookieOptions } from '../http/cookies.js'
import { buildClearCookies, extractAccessToken, extractRefreshToken } from '../http/cookies.js'
import type { HeaderBag } from '../http/headers.js'
import type { AuthContext, AuthUser, SessionStore, StoredSession, UserStore } from '../ports.js'
import type { RateGate } from '../rate-limit.js'
import { ipBucket } from '../rate-limit.js'
import { toMs } from '../time.js'
import type { AccessTokenPayload, JwtIdentity } from '../tokens.js'
import { hashToken, verifyAccessToken, verifyRefreshToken } from '../tokens.js'
import { createSessionIssuer } from './session-issuer.js'
import type { AccessOnlyPair, RefreshResult, RefreshSessionInput } from './types.js'

export interface SessionServiceDeps<TUser extends AuthUser, TMe, TCtx extends AuthContext> {
  users: UserStore<TUser, TCtx>
  sessions: SessionStore<TCtx>
  accessSecret: string
  refreshSecret: string
  identity: JwtIdentity
  accessTtlSec: number
  refreshTtlSec: number
  refreshGraceSec: number
  cookies: ResolvedCookieOptions
  isAllowed: (user: TUser) => boolean
  rolesOf: (user: TUser) => string[]
  toMe: (user: TUser) => TMe
  checkRate: RateGate<TCtx>
  refreshLimit: number
  createError: CreateAuthError
  notInvitedMessage: string
}

/**
 * Everything a session does once it exists, whichever sign-in method opened it: issue, rotate,
 * revoke, and read back from a request. No method reads `this`, so each can be passed around unbound.
 */
export const createSessionService = <TUser extends AuthUser, TMe, TCtx extends AuthContext>(
  deps: SessionServiceDeps<TUser, TMe, TCtx>,
) => {
  const { users, sessions, identity, cookies, createError } = deps

  const issuer = createSessionIssuer<TUser, TCtx>(deps)

  const fail = (message: string, code: AuthErrorCode, status: number): Error => {
    return createError({ message, code, status })
  }

  const invalidSession = (code: AuthErrorCode = 'INVALID_REFRESH_TOKEN'): Error => {
    return fail('Invalid session', code, 401)
  }

  const loadUser = async (userId: string, ctx?: TCtx): Promise<TUser> => {
    const user = await users.findById(userId, ctx)

    if (!user) throw fail('User not found', 'USER_NOT_FOUND', 401)

    return user
  }

  // An unparseable timestamp is expired, never "no expiry".
  const isExpired = (expiresAt: StoredSession['expiresAt']): boolean => {
    const expiresAtMs = toMs(expiresAt)

    return !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()
  }

  // Two tabs refreshing with one cookie: the later one presents a token the first rotated moments
  // ago. That is not theft, so inside the grace window it gets access to the successor session.
  const graceAccess = async (
    rotatedId: string,
    rotatedAt: Date | string,
    ctx?: TCtx,
  ): Promise<AccessOnlyPair | null> => {
    // Written so an unparseable `rotatedAt` (NaN) lands outside the window.
    const withinGrace = Date.now() - toMs(rotatedAt) < deps.refreshGraceSec * 1000

    if (!withinGrace) return null

    const successor = await sessions.findSuccessor(rotatedId, ctx)

    if (!successor || successor.revokedAt || isExpired(successor.expiresAt)) return null

    const user = await users.findById(successor.userId, ctx)

    return user && deps.isAllowed(user) ? issuer.grantAccess(user) : null
  }

  const requireUser = (headers: HeaderBag): AccessTokenPayload => {
    const token = extractAccessToken(headers, cookies.accessName)

    if (!token) throw fail('Missing access token', 'UNAUTHENTICATED', 401)

    return verifyAccessToken(token, deps.accessSecret, identity, createError)
  }

  const refreshSession = async (input: RefreshSessionInput, ctx?: TCtx): Promise<RefreshResult> => {
    const { refreshToken, ipAddress } = input

    if (!refreshToken) throw invalidSession('UNAUTHENTICATED')

    if (!(await deps.checkRate(`refresh:ip:${ipBucket(ipAddress)}`, deps.refreshLimit, ctx))) {
      ctx?.logger?.warn('Refresh rate limit exceeded', { data: { ipAddress } })
      throw fail('Too many requests', 'RATE_LIMITED', 429)
    }

    const payload = verifyRefreshToken(refreshToken, deps.refreshSecret, identity, createError)
    const session = await sessions.findByTokenHash(hashToken(refreshToken), ctx)

    if (!session) throw invalidSession()

    if (session.revokedAt) {
      const grace = await graceAccess(String(session.id), session.revokedAt, ctx)

      if (grace) return grace

      ctx?.logger?.warn('Refresh token reuse detected; revoking every session of the user', {
        data: { userId: session.userId },
      })
      await sessions.revokeAllForUser(session.userId, ctx)

      throw invalidSession()
    }

    if (isExpired(session.expiresAt)) throw invalidSession()

    const user = await users.findById(payload.sub, ctx)

    if (!user) throw invalidSession('USER_NOT_FOUND')

    // Refresh is where a long-lived session re-earns its right to exist, so a revoked invite must
    // end it here. Revoke every session: the siblings would walk straight back in on their next rotation.
    if (!deps.isAllowed(user)) {
      ctx?.logger?.warn('Refresh by a user who may no longer sign in; revoking every session', {
        data: { userId: String(user.id) },
      })
      await sessions.revokeAllForUser(String(user.id), ctx)

      throw fail(deps.notInvitedMessage, 'NOT_INVITED', 403)
    }

    const rotated = await issuer.rotate(session, user, ctx)

    if (rotated) return rotated

    // The `revokedAt` read above happens outside the rotation transaction, so two refreshes with one
    // live token both pass it and `rotate` settles the race under its row lock.
    const grace = await graceAccess(String(session.id), new Date(), ctx)

    if (grace) return grace

    ctx?.logger?.warn('Concurrent refresh lost the rotation race; failing this request only', {
      data: { userId: session.userId },
    })

    throw invalidSession()
  }

  /** Never throws: the browser's session ends whatever the store managed to revoke. */
  const logout = async (refreshToken: string | null, ctx?: TCtx): Promise<void> => {
    if (!refreshToken) return

    try {
      await sessions.revokeByTokenHash(hashToken(refreshToken), ctx)
    } catch (error) {
      ctx?.logger?.warn('Failed to revoke session on logout', { data: { name: errorName(error) } })
    }
  }

  /** `requireUser` plus the freshly loaded row: authorise from this, so a revoke applies on the next request. */
  const authenticate = async (
    headers: HeaderBag,
    ctx?: TCtx,
  ): Promise<{ payload: AccessTokenPayload; user: TUser }> => {
    const payload = requireUser(headers)

    return { payload, user: await loadUser(payload.sub, ctx) }
  }

  const getMe = async (payload: AccessTokenPayload, ctx?: TCtx): Promise<TMe> => {
    return deps.toMe(await loadUser(payload.sub, ctx))
  }

  return {
    /** Mint an access + refresh pair for `user` and persist the refresh session. */
    issueSession: issuer.issue,
    refreshSession,
    logout,
    /** The verified access-token payload, or UNAUTHENTICATED / INVALID_ACCESS_TOKEN (401). */
    requireUser,
    authenticate,
    getMe,

    extractAccessToken: (headers: HeaderBag): string | null => {
      return extractAccessToken(headers, cookies.accessName)
    },

    extractRefreshToken: (headers: HeaderBag): string | null => {
      return extractRefreshToken(headers, cookies.refreshName)
    },

    clearCookies: (): string[] => {
      return buildClearCookies(cookies)
    },
  }
}
