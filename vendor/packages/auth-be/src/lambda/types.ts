import type { HeaderBag } from '../http/headers.js'

/** The slice of an API Gateway (REST, v1) proxy event the routes read. */
export interface LambdaEvent {
  headers?: HeaderBag
  queryStringParameters?: Record<string, string | undefined> | null
  body?: string | null
  requestContext?: { identity?: { sourceIp?: string | null } }
}

/** Structurally an `APIGatewayProxyResult`. */
export interface LambdaResult {
  statusCode: number
  headers?: Record<string, string>
  multiValueHeaders?: Record<string, string[]>
  body: string
}

export interface AuthRoute<TCtx> {
  handle: (event: LambdaEvent, ctx?: TCtx) => Promise<LambdaResult>
  /** Set on routes that must never surface an error: the error is the host's to log, the client gets this. */
  fallbackResponse?: () => LambdaResult
  /** A 401 from this route also clears both cookies, so a dead refresh cookie leaves the browser. */
  clearCookiesOn401?: boolean
}
