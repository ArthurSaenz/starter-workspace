import type { AuthRedirectError } from '../types.js'

const MAX_REDIRECT_LENGTH = 2048

// A backslash reads as `/` in browsers (`/\evil.com` is `//evil.com`), and a `:` can start a scheme.
const hasUnsafeChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)

    if (code < 0x20 || code === 0x7f) return true
  }

  return value.includes('\\') || value.includes(':')
}

const isUnsafeDecodedPath = (pathname: string): boolean => {
  try {
    const decoded = decodeURIComponent(pathname)

    return decoded.startsWith('//') || decoded.includes('\\')
  } catch {
    return true
  }
}

/**
 * Defense-in-depth: the API already returns a server-sanitized redirect, but only ever follow an
 * in-app relative path so a regression upstream can never turn this into an open redirect.
 *
 * @example
 *     safeRedirect('/chat/1') // '/chat/1'
 *     safeRedirect('//evil.com') // '/'
 */
export const safeRedirect = (value?: unknown): string => {
  const isInAppPath =
    typeof value === 'string' &&
    value.length <= MAX_REDIRECT_LENGTH &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !hasUnsafeChars(value) &&
    // `/.//evil.com` resolves to `//evil.com`, and a router that decodes the path turns `/%2f%2fevil.com`
    // into it too; either may be handed on as protocol-relative.
    !isUnsafeDecodedPath(new URL(value, 'https://origin.invalid').pathname)

  return isInAppPath ? value : '/'
}

const AUTH_REDIRECT_ERRORS: Record<AuthRedirectError, true> = {
  cancelled: true,
  invalid_state: true,
  not_allowed: true,
  rate_limited: true,
  failed: true,
}

/**
 * Reads the `auth_error` search param the API appends after a failed Google sign-in.
 *
 * @example
 *     parseAuthRedirectError('not_allowed') // 'not_allowed'
 *     parseAuthRedirectError('toString') // null
 */
export const parseAuthRedirectError = (value: unknown): AuthRedirectError | null => {
  return typeof value === 'string' && Object.hasOwn(AUTH_REDIRECT_ERRORS, value) ? (value as AuthRedirectError) : null
}
