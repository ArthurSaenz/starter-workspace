/**
 * What the auth engine needs from its host. Every store method takes the caller's context as its
 * last argument and gets it back untouched, so a host whose repositories already take an options
 * bag (`{ logger }`) can pass them in as-is.
 */

// Rest params, so a structured logger with its own extra-argument union (powertools, pino) fits as-is.
export interface AuthLogger {
  info: (message: string, ...meta: Record<string, unknown>[]) => void
  warn: (message: string, ...meta: Record<string, unknown>[]) => void
  error: (message: string, ...meta: Record<string, unknown>[]) => void
}

export interface AuthContext {
  logger?: AuthLogger
}

/** The fields of a user row the engine reads; the host's row type can carry more. */
export interface AuthUser {
  id: string | number
  email: string
  invited?: boolean | null
  roles?: string[] | null
}

export interface UserStore<TUser extends AuthUser, TCtx extends AuthContext = AuthContext> {
  findByEmail: (email: string, ctx?: TCtx) => Promise<TUser | null | undefined>
  findById: (id: string, ctx?: TCtx) => Promise<TUser | null | undefined>
}

export interface NewMagicToken {
  email: string
  tokenHash: string
  redirectUrl?: string
  expiresAt?: Date
  ipAddress?: string
  userAgent?: string
}

export interface StoredMagicToken {
  email: string
  redirectUrl?: string | null
  expiresAt: Date | string
  /** When present, also bounds the token's age by this host's longest TTL (see `verifyMagicLink`). */
  createdAt?: Date | string
}

export interface MagicTokenStore<TCtx extends AuthContext = AuthContext> {
  create: (data: NewMagicToken, ctx?: TCtx) => Promise<unknown>
  /** Single use: returns the row and marks it spent in one step, or `null` if absent, spent or expired. */
  consumeByHash: (tokenHash: string, ctx?: TCtx) => Promise<StoredMagicToken | null>
  /**
   * Undo `consumeByHash` after the sign-in failed on a store or host error, so the next click works.
   * It undoes a consume only, never an invalidation: a link superseded by `invalidateByEmail` while
   * the sign-in ran must stay dead. `record` is what `consumeByHash` returned; a store that deleted
   * the row on consume re-inserts it only when no newer token exists for `record.email`, checked
   * and inserted in one atomic step.
   */
  release: (tokenHash: string, record: StoredMagicToken, ctx?: TCtx) => Promise<void>
  invalidateByEmail: (email: string, ctx?: TCtx) => Promise<void>
}

export interface NewSession {
  userId: string
  tokenHash: string
  jti: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
}

export interface StoredSession {
  id: string | number
  userId: string
  expiresAt: Date | string
  revokedAt?: Date | string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface SessionStore<TCtx extends AuthContext = AuthContext> {
  create: (data: NewSession, ctx?: TCtx) => Promise<unknown>
  findByTokenHash: (tokenHash: string, ctx?: TCtx) => Promise<StoredSession | null>
  /**
   * Revoke `oldId` and insert its successor atomically, resolving the new row. Must resolve `null`
   * when a concurrent caller already rotated `oldId`, never hand out a refresh token whose session
   * row was not written: the engine then answers from `findSuccessor` inside the grace window.
   */
  rotate: (oldId: string, next: NewSession, ctx?: TCtx) => Promise<StoredSession | null>
  /** The row `rotate(id, …)` inserted, whatever its state now; `null` if `id` was never rotated. */
  findSuccessor: (id: string, ctx?: TCtx) => Promise<StoredSession | null>
  revokeByTokenHash: (tokenHash: string, ctx?: TCtx) => Promise<void>
  revokeAllForUser: (userId: string, ctx?: TCtx) => Promise<void>
}

export interface RateLimiter<TCtx extends AuthContext = AuthContext> {
  incrementAndCheck: (key: string, limit: number, windowSec: number, ctx?: TCtx) => Promise<{ allowed: boolean }>
}

export interface MagicLinkEmail {
  to: string
  subject: string
  text: string
  html: string
}

export interface Mailer<TCtx extends AuthContext = AuthContext> {
  send: (email: MagicLinkEmail, ctx?: TCtx) => Promise<void>
}
