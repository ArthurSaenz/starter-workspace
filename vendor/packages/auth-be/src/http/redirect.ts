/** Control characters, or a backslash: browsers read `/\evil.com` as the protocol-relative `//evil.com`. */
export const hasUnsafeRedirectChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)

    if (code < 0x20 || code === 0x7f) return true
  }

  return value.includes('\\')
}

/**
 * Only an in-app path survives; anything that could leave the origin, or is not a string at all
 * (a store's odd column type), becomes `/`. Never throws.
 */
export const sanitizeRedirectUrl = (input: unknown): string => {
  if (typeof input !== 'string' || !input || input.length > 2048 || hasUnsafeRedirectChars(input)) return '/'

  if (input.startsWith('//') || input.includes(':')) return '/'

  const path = input.startsWith('/') ? input : `/${input}`

  // `/.//evil.com` resolves to the path `//evil.com`, which a router may hand on as a protocol-relative URL.
  return new URL(path, 'https://origin.invalid').pathname.startsWith('//') ? '/' : path
}
