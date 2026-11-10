import { AuthError } from '../errors.js'
import type { MagicLinkAuth } from '../magicLink/magicLinkAuth.js'
import type { AuthContext, AuthUser } from '../ports.js'
import type { AuthRoutesOptions } from './routes.js'
import { createAuthRoutes } from './routes.js'
import type { AuthRoute, LambdaEvent, LambdaResult } from './types.js'

export interface ToLambdaHandlerOptions<TCtx> {
  corsHeaders: () => Record<string, string>
  clearCookies: () => string[]
  context?: (event: LambdaEvent) => TCtx
  /** Maps any thrown error to a status + body; the default understands {@link AuthError}. */
  toErrorResponse?: (error: unknown) => { statusCode: number; body: unknown }
  onError?: (error: unknown) => void
}

const defaultErrorResponse = (error: unknown): { statusCode: number; body: unknown } => {
  if (error instanceof AuthError) {
    return { statusCode: error.status, body: { type: error.code, message: error.message } }
  }

  return { statusCode: 500, body: { type: 'INTERNAL_ERROR', message: 'Internal error' } }
}

/** A ready Lambda handler for hosts without their own controller envelope. */
export const toLambdaHandler = <TCtx>(route: AuthRoute<TCtx>, options: ToLambdaHandlerOptions<TCtx>) => {
  return async (event: LambdaEvent): Promise<LambdaResult> => {
    try {
      return await route.handle(event, options.context?.(event))
    } catch (error) {
      options.onError?.(error)

      if (route.fallbackResponse) return route.fallbackResponse()

      const { statusCode, body } = (options.toErrorResponse ?? defaultErrorResponse)(error)
      const result: LambdaResult = { statusCode, headers: options.corsHeaders(), body: JSON.stringify(body) }

      if (route.clearCookiesOn401 && statusCode === 401) {
        return { ...result, multiValueHeaders: { 'Set-Cookie': options.clearCookies() } }
      }

      return result
    }
  }
}

export type AuthHandlersOptions<TCtx> = AuthRoutesOptions &
  Pick<ToLambdaHandlerOptions<TCtx>, 'context' | 'toErrorResponse' | 'onError'>

/**
 * {@link createAuthRoutes} and {@link toLambdaHandler} in one call: the five endpoints as ready
 * Lambda handlers, for a host with no controller envelope of its own.
 */
export const createAuthHandlers = <TUser extends AuthUser, TMe, TCtx extends AuthContext>(
  auth: MagicLinkAuth<TUser, TMe, TCtx>,
  options: AuthHandlersOptions<TCtx>,
) => {
  const routes = createAuthRoutes(auth, options)

  const toHandler = (route: AuthRoute<TCtx>) => {
    return toLambdaHandler(route, { ...options, clearCookies: auth.clearCookies })
  }

  return {
    requestMagicLink: toHandler(routes.requestMagicLink),
    verifyMagicLink: toHandler(routes.verifyMagicLink),
    refresh: toHandler(routes.refresh),
    logout: toHandler(routes.logout),
    me: toHandler(routes.me),
  }
}
