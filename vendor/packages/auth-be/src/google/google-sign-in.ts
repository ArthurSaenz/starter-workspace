import { safeSecretEqual } from '../e2e-login.js'
import { errorName } from '../errors.js'
import { parseCookieHeader } from '../http/cookies.js'
import type { HeaderBag } from '../http/headers.js'
import { readHeader } from '../http/headers.js'
import { sanitizeRedirectUrl } from '../http/redirect.js'
import type { AuthContext, AuthUser, UserStore } from '../ports.js'
import type { RateGate } from '../rate-limit.js'
import { ipBucket } from '../rate-limit.js'
import type { RequestMeta, TokenPair } from '../session/types.js'
import type { AuthMethod, JwtIdentity } from '../tokens.js'
import type { GoogleFailureStep, GoogleIdentity, GoogleSignInConfig, GoogleSignInError } from './config.js'
import {
  DEFAULT_GOOGLE_ERROR_PATH,
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_TIMEOUT_MS,
  GOOGLE_TOKEN_ENDPOINT,
} from './config.js'
import { createIdTokenVerifier } from './id-token.js'
import { pkceChallenge, randomUrlToken } from './pkce.js'
import type { GoogleState } from './state-cookie.js'
import {
  STATE_COOKIE_NAME,
  STATE_TTL_SEC,
  buildStateCookie,
  createStateKey,
  signState,
  verifyState,
} from './state-cookie.js'

export interface GoogleStartResult {
  location: string
  stateCookie: string
}

export interface GoogleCallbackInput extends RequestMeta {
  /** Absent parameters are `undefined`, as API Gateway's query map hands them over. */
  query: { code: string | undefined; state: string | undefined; error: string | undefined }
  headers: HeaderBag
}

export type GoogleCallbackResult =
  | { ok: true; location: string; cookies: string[] }
  | { ok: false; reason: GoogleSignInError; location: string; cookies: string[] }

export interface GoogleSignIn<TCtx extends AuthContext = AuthContext> {
  start: (input: { redirectUrl: string | undefined }) => GoogleStartResult
  /** Never rejects: every outcome is a 302 target plus the cookies to set. */
  complete: (input: GoogleCallbackInput, ctx?: TCtx) => Promise<GoogleCallbackResult>
  /** The `Max-Age=0` state cookie, same name and `Path` as `start` sets. */
  clearStateCookie: () => string
  /** The error-page URL a failure lands on, without a `redirect` parameter. */
  failureLocation: (reason: GoogleSignInError) => string
}

export interface GoogleSignInDeps<TUser extends AuthUser, TCtx extends AuthContext> {
  google: GoogleSignInConfig<TUser, TCtx>
  /** Arrives normalised (no trailing `/`). */
  baseUrl: string
  identity: JwtIdentity
  accessSecret: string
  users: UserStore<TUser, TCtx>
  isAllowed: (user: TUser) => boolean
  checkRate: RateGate<TCtx>
  verifyLimit: number
  issueSession: (
    user: TUser,
    meta?: RequestMeta,
    ctx?: TCtx,
    options?: { authMethod?: AuthMethod },
  ) => Promise<TokenPair>
  onSignIn: ((user: TUser, ctx?: TCtx) => Promise<void>) | undefined
}

interface Refusal {
  reason: GoogleSignInError
  step: GoogleFailureStep
}

type Outcome<T> = { ok: true; value: T } | { ok: false; refusal: Refusal }

type LogLevel = 'info' | 'warn' | 'error'

const refuse = (reason: GoogleSignInError, step: GoogleFailureStep): { ok: false; refusal: Refusal } => {
  return { ok: false, refusal: { reason, step } }
}

/**
 * Google sign-in, server side: Authorization Code + PKCE (S256) + `state` + `nonce`, carried between
 * start and callback in one signed cookie. Opens the same session as a magic link, via `issueSession`.
 */
export const createGoogleSignIn = <TUser extends AuthUser, TCtx extends AuthContext>(
  deps: GoogleSignInDeps<TUser, TCtx>,
): GoogleSignIn<TCtx> => {
  const { google, baseUrl, identity, users, isAllowed } = deps
  const fetchImpl = google.fetch ?? fetch
  const errorPath = google.errorPath ?? DEFAULT_GOOGLE_ERROR_PATH

  const hostedDomains = google.hostedDomains?.map((domain) => {
    return domain.toLowerCase()
  })

  const stateKey = createStateKey(deps.accessSecret)
  const cookiePath = new URL(google.redirectUri).pathname
  const verifyIdToken = createIdTokenVerifier({ clientId: google.clientId, fetch: fetchImpl })

  const clearStateCookie = (): string => {
    return buildStateCookie(cookiePath, '', 0)
  }

  const failureLocation = (reason: GoogleSignInError): string => {
    return `${baseUrl}${errorPath}?auth_error=${reason}`
  }

  const fail = (refusal: Refusal, redirect: string, ctx: TCtx | undefined, level: LogLevel, extra = {}) => {
    ctx?.logger?.[level]('Google sign-in failed', { data: { ...refusal, ...extra } })

    const location = failureLocation(refusal.reason)

    return {
      ok: false as const,
      reason: refusal.reason,
      location: redirect === '/' ? location : `${location}&redirect=${encodeURIComponent(redirect)}`,
      cookies: [clearStateCookie()],
    }
  }

  const start = (input: { redirectUrl: string | undefined }): GoogleStartResult => {
    const verifier = randomUrlToken()

    const state: GoogleState = {
      s: randomUrlToken(),
      n: randomUrlToken(),
      v: verifier,
      r: sanitizeRedirectUrl(input.redirectUrl),
    }

    const hdHint = hostedDomains?.length === 1 ? hostedDomains[0] : undefined

    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: google.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state: state.s,
      nonce: state.n,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      // A UI hint only; the `hd` claim is what is enforced.
      ...(hdHint ? { hd: hdHint } : {}),
    })

    return {
      location: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`,
      stateCookie: buildStateCookie(cookiePath, signState(stateKey, state, identity), STATE_TTL_SEC),
    }
  }

  // Step 1: the cookie binds this callback to the browser that started it (login CSRF).
  const readState = (input: GoogleCallbackInput): Outcome<GoogleState> => {
    const raw = parseCookieHeader(readHeader(input.headers, 'cookie'))[STATE_COOKIE_NAME]

    if (!raw) return refuse('invalid_state', 'missing-cookie')

    const checked = verifyState(stateKey, raw, identity)

    if (!checked.ok) return refuse('invalid_state', checked.step)

    if (!safeSecretEqual(input.query.state, checked.state.s)) return refuse('invalid_state', 'mismatch')

    return { ok: true, value: checked.state }
  }

  // Step 4. Any failure, a timeout included, is one outcome: no ID token.
  const exchangeCode = async (code: string | undefined, verifier: string): Promise<string | null> => {
    if (!code) return null

    try {
      const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: google.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      })

      if (!response.ok) return null

      const body: unknown = await response.json()
      const idToken = typeof body === 'object' && body !== null && 'id_token' in body ? body.id_token : null

      return typeof idToken === 'string' && idToken ? idToken : null
    } catch {
      return null
    }
  }

  // Steps 7–9. `hostedDomains` binds `resolveUser` too; `resolveUser`'s answer is final.
  const resolveUser = async (googleIdentity: GoogleIdentity, ctx?: TCtx): Promise<Outcome<TUser>> => {
    if (!googleIdentity.emailVerified) return refuse('not_allowed', 'email')

    const { hostedDomain } = googleIdentity

    if (hostedDomains && !(hostedDomain && hostedDomains.includes(hostedDomain))) {
      return refuse('not_allowed', 'hosted-domain')
    }

    if (!google.resolveUser && !googleIdentity.emailAuthoritative) return refuse('not_allowed', 'email')

    // Never creates a user: only an existing, allowed row signs in.
    const user = google.resolveUser
      ? await google.resolveUser(googleIdentity, ctx)
      : await users.findByEmail(googleIdentity.email.trim().toLowerCase(), ctx)

    if (!user || !isAllowed(user)) return refuse('not_allowed', 'user')

    return { ok: true, value: user }
  }

  // Steps 3–10.
  const signIn = async (
    input: GoogleCallbackInput,
    state: GoogleState,
    ctx?: TCtx,
  ): Promise<Outcome<{ user: TUser; pair: TokenPair }>> => {
    if (!(await deps.checkRate(`google:ip:${ipBucket(input.ipAddress)}`, deps.verifyLimit, ctx))) {
      return refuse('rate_limited', 'rate-limit')
    }

    const idToken = await exchangeCode(input.query.code, state.v)

    if (!idToken) return refuse('failed', 'token-exchange')

    const verified = await verifyIdToken(idToken, state.n, ctx?.logger)

    if (!verified.ok) return refuse('failed', verified.step)

    const resolved = await resolveUser(verified.identity, ctx)

    if (!resolved.ok) return resolved

    const user = resolved.value

    await deps.onSignIn?.(user, ctx)

    const pair = await deps.issueSession(user, input, ctx, { authMethod: 'google' })

    return { ok: true, value: { user, pair } }
  }

  const complete = async (input: GoogleCallbackInput, ctx?: TCtx): Promise<GoogleCallbackResult> => {
    const state = readState(input)

    // The redirect is unknown until the cookie proves authentic, so an invalid state lands without one.
    if (!state.ok) return fail(state.refusal, '/', ctx, 'warn')

    // Signed at start, sanitised again in case a key or a sanitiser rule changed in between.
    const redirect = sanitizeRedirectUrl(state.value.r)
    const providerError = input.query.error

    if (providerError) {
      // The user closing the consent screen is a choice, not a fault.
      const cancelled = providerError === 'access_denied'

      return fail(
        { reason: cancelled ? 'cancelled' : 'failed', step: 'provider-error' },
        redirect,
        ctx,
        cancelled ? 'info' : 'warn',
      )
    }

    let outcome: Outcome<{ user: TUser; pair: TokenPair }>

    try {
      outcome = await signIn(input, state.value, ctx)
    } catch (error) {
      return fail({ reason: 'failed', step: 'store' }, redirect, ctx, 'error', { name: errorName(error) })
    }

    if (!outcome.ok) return fail(outcome.refusal, redirect, ctx, 'warn')

    const { user, pair } = outcome.value

    ctx?.logger?.info('Google sign-in succeeded', { data: { userId: String(user.id) } })

    return {
      ok: true,
      location: `${baseUrl}${redirect}`,
      cookies: [pair.accessCookie, pair.refreshCookie, clearStateCookie()],
    }
  }

  return { start, complete, clearStateCookie, failureLocation }
}
