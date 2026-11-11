const MAX_REDIRECT_LENGTH = 2048

// A backslash reads as `/` in browsers (`/\evil.com` is `//evil.com`), and a `:` can start a scheme.
const hasUnsafeChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)

    if (code < 0x20 || code === 0x7f) return true
  }

  return value.includes('\\') || value.includes(':')
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
    // `/.//evil.com` resolves to the path `//evil.com`, which a router may hand on as protocol-relative.
    !new URL(value, 'https://origin.invalid').pathname.startsWith('//')

  return isInAppPath ? value : '/'
}
