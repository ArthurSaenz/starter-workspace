export { createE2eLogin, parseAllowedEmails, safeSecretEqual } from './e2eLogin.js'
export type { E2eLoginConfig, E2eLoginInput } from './e2eLogin.js'
export { AuthError, defaultCreateAuthError } from './errors.js'
export type { AuthErrorCode, AuthErrorInit, CreateAuthError } from './errors.js'
export {
  buildAccessCookie,
  buildClearCookies,
  buildRefreshCookie,
  extractAccessToken,
  extractRefreshToken,
  parseCookieHeader,
  resolveCookieOptions,
} from './http/cookies.js'
export type { CookieOptions, ResolvedCookieOptions } from './http/cookies.js'
export { readHeader } from './http/headers.js'
export type { HeaderBag } from './http/headers.js'
export { sanitizeRedirectUrl } from './http/redirect.js'
export { extractSourceIp, extractUserAgent } from './lambda/clientIp.js'
export type { ClientIpOptions } from './lambda/clientIp.js'
export { createAuthHandlers, toLambdaHandler } from './lambda/handler.js'
export type { AuthHandlersOptions, ToLambdaHandlerOptions } from './lambda/handler.js'
export { createAuthRoutes } from './lambda/routes.js'
export type { AuthRoutesOptions } from './lambda/routes.js'
export type { AuthRoute, LambdaEvent, LambdaResult } from './lambda/types.js'
export { DEFAULT_INVITE_TOKEN_TTL_MIN, DEFAULT_MAGIC_TOKEN_TTL_MIN } from './magicLink/config.js'
export type {
  MagicLinkAuthConfig,
  RequestMagicLinkInput,
  VerifyMagicLinkInput,
  VerifyMagicLinkResult,
} from './magicLink/config.js'
export { buildMagicLinkUrl, formatExpiry, renderMagicLinkEmail } from './magicLink/email.js'
export type {
  MagicLinkEmailInput,
  MagicLinkEmailKind,
  MagicLinkEmailText,
  RenderMagicLinkEmail,
} from './magicLink/email.js'
export { createMagicLinkAuth } from './magicLink/magicLinkAuth.js'
export type { MagicLinkAuth } from './magicLink/magicLinkAuth.js'
export type { RequestValidationInput } from './magicLink/validation.js'
export type {
  AuthContext,
  AuthLogger,
  AuthUser,
  MagicLinkEmail,
  MagicTokenStore,
  Mailer,
  NewMagicToken,
  NewSession,
  RateLimiter,
  SessionStore,
  StoredMagicToken,
  StoredSession,
  UserStore,
} from './ports.js'
export type { RateLimitConfig } from './rateLimit.js'
export type { RefreshSessionInput, RequestMeta, TokenPair } from './session/types.js'
export { verifySession } from './session/verifySession.js'
export type { VerifySessionOptions } from './session/verifySession.js'
export {
  DEFAULT_ACCESS_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  generateRawToken,
  hashToken,
  MIN_SECRET_LENGTH,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './tokens.js'
export type { AccessTokenPayload, JwtIdentity, RefreshTokenPayload, SignedToken } from './tokens.js'
