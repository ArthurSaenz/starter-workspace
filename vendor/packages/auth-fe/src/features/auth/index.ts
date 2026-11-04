export { useAuth, useAuthStore } from '../../lib/auth-context.js'
export { AuthFormContainer } from './containers/auth-form-container.js'
export { AuthProvider, AuthProviderContainer } from './containers/auth-provider-container.js'
export { AuthVerifyContainer } from './containers/auth-verify-container.js'
export { RequireAuthContainer } from './containers/require-auth-container.js'
export { UserMenuContainer } from './containers/user-menu-container.js'
export { AuthHttpError, createAuthClient, isUnauthorized } from './services/api.js'
export { safeRedirect } from './services/libs.js'
export { createAuthStore, DEFAULT_REQUEST_ERROR_TEXT } from './services/main.js'
export type {
  AuthClient,
  AuthClientOptions,
  AuthFormContainerProps,
  AuthFormRenderProps,
  AuthPaths,
  AuthProviderProps,
  AuthState,
  AuthStatus,
  AuthStore,
  AuthStoreOptions,
  AuthVerifyContainerProps,
  AuthVerifyState,
  MagicLinkRequest,
  MagicLinkResult,
  RequireAuthContainerProps,
  SessionRenderProps,
  UserMenuContainerProps,
  VerifyMagicLinkResult,
} from './types.js'
