// The hooks in src/lib/ need these, and a feature's private files are off-limits to them.
export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

export interface MagicLinkRequest {
  email: string
  redirectUrl?: string
}

export interface MagicLinkResult {
  ok: boolean
  email: string
}

export interface VerifyMagicLinkResult {
  ok: boolean
  redirect?: string
  /** The error body's `type` (e.g. `INVALID_OR_EXPIRED_TOKEN`); absent on a network failure. */
  errorCode?: string
}

export interface AuthState<TUser> {
  status: AuthStatus
  user: TUser | null
  /** A magic-link request is in flight. */
  requestLoading: boolean
  /** Where the last link went; the form shows its "check your inbox" state while set. */
  sentToEmail: string | null
  requestError: string | null
  /** A `fetchMe` is in flight. */
  isSessionLoading: boolean
}

export interface AuthStore<TUser> {
  getState: () => AuthState<TUser>
  subscribe: (listener: () => void) => () => void
  /** Trims and lower-cases the email before sending it. */
  submitEmail: (request: MagicLinkRequest) => Promise<MagicLinkResult>
  resetSentEmail: () => void
  /** Concurrent callers share one in-flight request; a 401 gets one silent refresh and one retry. */
  fetchMe: () => Promise<TUser | null>
  /**
   * Exchanges the token for the session cookies and, on success, loads the user before resolving,
   * so `authenticated` is only ever published with a user; it never sets `status` itself. A `/me`
   * already in flight was sent with the pre-verify cookies, so it is awaited and then repeated. A
   * `logout` during `verify` skips the load.
   */
  verify: (token: string) => Promise<VerifyMagicLinkResult>
  /** Clears the local session even when the request fails; a `/me` still in flight is discarded. */
  logout: () => Promise<void>
  refresh: () => Promise<boolean>
}
