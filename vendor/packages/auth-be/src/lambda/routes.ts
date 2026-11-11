import { Buffer } from 'node:buffer'

import type { MagicLinkAuth } from '../magic-link/magic-link-auth.js'
import type { AuthContext, AuthUser } from '../ports.js'
import type { RequestMeta } from '../session/types.js'
import type { ClientIpOptions } from './client-ip.js'
import { createClientIpResolver, extractUserAgent } from './client-ip.js'
import type { AuthRoute, LambdaEvent, LambdaResult } from './types.js'

export interface AuthRoutesOptions {
  corsHeaders: () => Record<string, string>
  /** The body every link request gets, whatever happened. */
  requestMagicLinkMessage?: string
  /**
   * The rate limits key on this IP. `trustedProxyHops` counts the proxies you run in front of API
   * Gateway; 0 trusts only `sourceIp`. Measure it in a dev stage, never guess: see the readme's
   * topology table.
   */
  clientIp: ClientIpOptions
}

/**
 * The five auth endpoints as Lambda bodies: `POST magic-link`, `GET magic-link/verify?token=`,
 * `POST refresh`, `POST logout`, `GET me`. Each `handle` throws the engine's errors; wrap it with
 * the host's error envelope, honouring `fallbackResponse` / `clearCookiesOn401`, or use
 * {@link toLambdaHandler}.
 */
export const createAuthRoutes = <TUser extends AuthUser, TMe, TCtx extends AuthContext>(
  auth: MagicLinkAuth<TUser, TMe, TCtx>,
  options: AuthRoutesOptions,
) => {
  const { corsHeaders } = options
  const clientIp = createClientIpResolver<TCtx>(options.clientIp)

  const requestMeta = (event: LambdaEvent, ctx?: TCtx): RequestMeta => {
    return { ipAddress: clientIp(event, ctx), userAgent: extractUserAgent(event) }
  }

  const json = (statusCode: number, body: unknown): LambdaResult => {
    return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) }
  }

  const withCookies = (body: unknown, cookies: string[]): LambdaResult => {
    return { ...json(200, body), multiValueHeaders: { 'Set-Cookie': cookies } }
  }

  const genericOk = (): LambdaResult => {
    return json(200, {
      message: options.requestMagicLinkMessage ?? 'If that email exists, a sign-in link has been sent.',
    })
  }

  const noContent = (): LambdaResult => {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      multiValueHeaders: { 'Set-Cookie': auth.clearCookies() },
      body: '',
    }
  }

  const requestMagicLink: AuthRoute<TCtx> = {
    handle: async (event, ctx) => {
      let parsed: unknown = null

      if (event.body) {
        try {
          // An API with `*/*` among its binary media types hands even a JSON body over base64-encoded.
          parsed = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
        } catch {
          return genericOk()
        }
      }

      // Any other JSON (null, a number, an array, a non-string field) falls through to validation as ''.
      const body: { email?: unknown; redirectUrl?: unknown } =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}

      await auth.requestMagicLink(
        {
          email: typeof body.email === 'string' ? body.email : '',
          ...(typeof body.redirectUrl === 'string' && body.redirectUrl ? { redirectUrl: body.redirectUrl } : {}),
          ...requestMeta(event, ctx),
        },
        ctx,
      )

      return genericOk()
    },
    // A silent surface answers the same body for every outcome, errors included: a 500 on one
    // address and a 200 on another would be the membership oracle `silent` exists to close.
    ...(auth.uninvitedRequest === 'silent' ? { fallbackResponse: genericOk } : {}),
  }

  // Answers JSON, not a 302: the SPA's verify page calls this with fetch, which would follow a
  // redirect silently. The cookies ride along on the same-origin response.
  const verifyMagicLink: AuthRoute<TCtx> = {
    handle: async (event, ctx) => {
      // eslint-disable-next-line dot-notation -- `noPropertyAccessFromIndexSignature` requires brackets here
      const rawToken = (event.queryStringParameters?.['token'] || '').toString().trim()
      const result = await auth.verifyMagicLink({ rawToken, ...requestMeta(event, ctx) }, ctx)

      return withCookies({ ok: true, redirect: result.redirectUrl }, [result.accessCookie, result.refreshCookie])
    },
  }

  const refresh: AuthRoute<TCtx> = {
    handle: async (event, ctx) => {
      const pair = await auth.refreshSession(
        { refreshToken: auth.extractRefreshToken(event.headers) || '', ipAddress: clientIp(event, ctx) },
        ctx,
      )

      return withCookies({ ok: true }, [pair.accessCookie, pair.refreshCookie])
    },
    clearCookiesOn401: true,
  }

  // Logout always ends the browser's session, whatever the server side managed to revoke.
  const logout: AuthRoute<TCtx> = {
    handle: async (event, ctx) => {
      await auth.logout(auth.extractRefreshToken(event.headers), ctx)

      return noContent()
    },
    fallbackResponse: noContent,
  }

  const me: AuthRoute<TCtx> = {
    handle: async (event, ctx) => {
      return json(200, await auth.getMe(auth.requireUser(event.headers), ctx))
    },
  }

  return { requestMagicLink, verifyMagicLink, refresh, logout, me }
}
