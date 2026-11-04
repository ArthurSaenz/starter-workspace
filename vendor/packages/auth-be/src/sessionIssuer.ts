import crypto from 'node:crypto'

import type { CreateAuthError } from './errors.js'
import type { ResolvedCookieOptions } from './http.js'
import { buildAccessCookie, buildRefreshCookie } from './http.js'
import type { RequestMeta, TokenPair } from './magicLinkConfig.js'
import { withMeta } from './magicLinkConfig.js'
import type { AuthContext, AuthUser, NewSession, SessionStore, StoredSession } from './ports.js'
import type { JwtIdentity, SignedToken } from './tokens.js'
import { hashToken, signAccessToken, signRefreshToken } from './tokens.js'

export interface SessionIssuerDeps<TUser extends AuthUser, TCtx extends AuthContext> {
  accessSecret: string
  refreshSecret: string
  identity: JwtIdentity
  accessTtlSec: number
  refreshTtlSec: number
  sessions: SessionStore<TCtx>
  cookies: ResolvedCookieOptions
  rolesOf: (user: TUser) => string[]
  createError: CreateAuthError
}

/** Mints access + refresh pairs and persists their sessions; `issue` and `rotate` never read `this`. */
export const createSessionIssuer = <TUser extends AuthUser, TCtx extends AuthContext>(
  deps: SessionIssuerDeps<TUser, TCtx>,
) => {
  const { sessions, cookies, identity } = deps

  const toPair = (access: SignedToken, refresh: SignedToken): TokenPair => {
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessCookie: buildAccessCookie(cookies, access.token, access.ttlSec),
      refreshCookie: buildRefreshCookie(cookies, refresh.token, refresh.ttlSec),
    }
  }

  const mintPair = (user: TUser, meta: Parameters<typeof withMeta>[0]) => {
    const userId = String(user.id)
    const jti = crypto.randomUUID()

    const access = signAccessToken(
      { sub: userId, roles: deps.rolesOf(user), authMethod: 'magic' },
      deps.accessSecret,
      identity,
      deps.accessTtlSec,
    )

    const refresh = signRefreshToken({ sub: userId, jti }, deps.refreshSecret, identity, deps.refreshTtlSec)

    const session: NewSession = {
      userId,
      tokenHash: hashToken(refresh.token),
      jti,
      expiresAt: new Date(Date.now() + refresh.ttlSec * 1000),
      ...withMeta(meta),
    }

    return { access, refresh, jti, session }
  }

  /** Mint an access + refresh pair for `user` and persist the refresh session. */
  const issue = async (user: TUser, meta?: RequestMeta, ctx?: TCtx): Promise<TokenPair> => {
    const { access, refresh, session } = mintPair(user, meta)

    await sessions.create(session, ctx)

    return toPair(access, refresh)
  }

  const rotate = async (current: StoredSession, user: TUser, ctx?: TCtx): Promise<TokenPair> => {
    const { access, refresh, session } = mintPair(user, current)
    const rotated = await sessions.rotate(String(current.id), session, ctx)

    // The `revokedAt` read in refresh happens outside the rotation transaction, so two refreshes
    // presenting the same live token (a parallel tab, not an attack) both pass it; `rotate` settles
    // the race under its row lock. Fail only the loser: the winner's session stays valid.
    if (!rotated) {
      ctx?.logger?.warn('Concurrent refresh lost the rotation race; failing this request only', {
        data: { userId: session.userId },
      })

      throw deps.createError({ message: 'Invalid session', code: 'INVALID_REFRESH_TOKEN', status: 401 })
    }

    return toPair(access, refresh)
  }

  return { issue, rotate }
}
