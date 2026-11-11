import crypto from 'node:crypto'

import type { ResolvedCookieOptions } from '../http/cookies.js'
import { buildAccessCookie, buildRefreshCookie } from '../http/cookies.js'
import type { AuthContext, AuthUser, NewSession, SessionStore, StoredSession } from '../ports.js'
import type { JwtIdentity, SignedToken } from '../tokens.js'
import { hashToken, signAccessToken, signRefreshToken } from '../tokens.js'
import type { AccessOnlyPair, RequestMeta, TokenPair } from './types.js'
import { withMeta } from './types.js'

export interface SessionIssuerDeps<TUser extends AuthUser, TCtx extends AuthContext> {
  accessSecret: string
  refreshSecret: string
  identity: JwtIdentity
  accessTtlSec: number
  refreshTtlSec: number
  sessions: SessionStore<TCtx>
  cookies: ResolvedCookieOptions
  rolesOf: (user: TUser) => string[]
}

/** Mints access + refresh pairs and persists their sessions; no method reads `this`. */
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

  const signAccess = (user: TUser): SignedToken => {
    return signAccessToken(
      { sub: String(user.id), roles: deps.rolesOf(user), authMethod: 'magic' },
      deps.accessSecret,
      identity,
      deps.accessTtlSec,
    )
  }

  const mintPair = (user: TUser, meta: Parameters<typeof withMeta>[0]) => {
    const userId = String(user.id)
    const jti = crypto.randomUUID()
    const access = signAccess(user)

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

  /** `null` when a concurrent caller won the rotation: nothing minted here may be handed out. */
  const rotate = async (current: StoredSession, user: TUser, ctx?: TCtx): Promise<TokenPair | null> => {
    const { access, refresh, session } = mintPair(user, current)
    const rotated = await sessions.rotate(String(current.id), session, ctx)

    return rotated ? toPair(access, refresh) : null
  }

  const grantAccess = (user: TUser): AccessOnlyPair => {
    const access = signAccess(user)

    return { accessToken: access.token, accessCookie: buildAccessCookie(cookies, access.token, access.ttlSec) }
  }

  return { issue, rotate, grantAccess }
}
