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

  // Revoke as well as refuse: the FE refreshes only on a 401, so after this 403 nothing else ends the
  // rows, and a re-invite inside `refreshTtlSec` would revive them.
  const loadAllowedUser = async (userId: string, ctx?: TCtx): Promise<TUser> => {
    const user = await loadUser(userId, ctx)

    if (deps.isAllowed(user)) return user

    ctx?.logger?.warn('Authenticated request by a user who may no longer sign in; revoking every session', {
      data: { userId: String(user.id) },
    })

    try {
      await sessions.revokeAllForUser(String(user.id), ctx)
    } catch (error) {
      ctx?.logger?.error('Failed to revoke the sessions of a user who may no longer sign in', {
        data: { name: errorName(error) },
      })
    }

    throw fail(deps.notInvitedMessage, 'NOT_INVITED', 403)
  }

  // An unparseable timestamp is expired, never "no expiry".
  const isExpired = (expiresAt: StoredSession['expiresAt']): boolean => {
    const expiresAtMs = toMs(expiresAt)

    return !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()
  }

  // Written so an unparseable `rotatedAt` (NaN) lands outside the window.
  const withinGrace = (rotatedAt: Date | string): boolean => {
    return Date.now() - toMs(rotatedAt) < deps.refreshGraceSec * 1000
  }

  // Two tabs refreshing with one cookie: the later one presents a token the first rotated moments
  // ago. That is not theft, so inside the grace window it gets access to the successor session.
  const graceAccess = async (
    rotatedId: string,
    successor: StoredSession | null,
    subject: string,
    ctx?: TCtx,
  ): Promise<AccessOnlyPair | null> => {
    if (!successor || successor.revokedAt || isExpired(successor.expiresAt)) return null

    if (String(successor.userId) !== subject) {
      ctx?.logger?.error('Refresh token subject does not match its session row', {
        data: { sessionId: rotatedId, successorSessionId: String(successor.id) },
      })
      throw invalidSession()
    }

    const user = await users.findById(successor.userId, ctx)

    if (!user || !deps.isAllowed(user)) return null

    // A thief who refreshed first lands the victim here too; this line is the only trace of it.
    ctx?.logger?.warn('Refresh answered from the grace window with a rotated token', {
      data: { userId: successor.userId, rotatedSessionId: rotatedId, successorSessionId: String(successor.id) },
    })

    return issuer.grantAccess(user)
  }

  const refreshRevoked = async (
    session: StoredSession,
    revokedAt: Date | string,
    subject: string,
    ctx?: TCtx,
  ): Promise<AccessOnlyPair> => {
    const sessionId = String(session.id)
    const successor = await sessions.findSuccessor(sessionId, ctx)
    const grace = withinGrace(revokedAt) ? await graceAccess(sessionId, successor, subject, ctx) : null

    if (grace) return grace

    // Revoked by a logout or a revoke-all, not by rotation: no successor was handed out, so a
    // replay of this token is not evidence of theft.
    if (!successor) {
      ctx?.logger?.warn('Refresh with a revoked, never-rotated token', { data: { userId: session.userId } })
      throw invalidSession()
    }

    ctx?.logger?.warn('Refresh token reuse detected; revoking every session of the user', {
      data: { userId: session.userId },
    })
    await sessions.revokeAllForUser(session.userId, ctx)

    throw invalidSession()
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

    const sessionId = String(session.id)

    if (String(session.userId) !== payload.sub) {
      ctx?.logger?.error('Refresh token subject does not match its session row', { data: { sessionId } })
      throw invalidSession()
    }

    if (session.revokedAt) return refreshRevoked(session, session.revokedAt, payload.sub, ctx)

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
    const grace = withinGrace(new Date())
      ? await graceAccess(sessionId, await sessions.findSuccessor(sessionId, ctx), payload.sub, ctx)
      : null

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

    return { payload, user: await loadAllowedUser(payload.sub, ctx) }
  }

  const getMe = async (payload: AccessTokenPayload, ctx?: TCtx): Promise<TMe> => {
    return deps.toMe(await loadAllowedUser(payload.sub, ctx))
  }

  return {
    /** Mint an access + refresh pair for `user` and persist the refresh session. */
    issueSession: issuer.issue,
    refreshSession,
    logout,
    /**
     * The verified access-token payload, or UNAUTHENTICATED / INVALID_ACCESS_TOKEN (401). JWT only: a
     * revoke reaches it when the access token expires (`accessTtlSec`); authorise from `authenticate`
     * where that lag matters.
     */
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
