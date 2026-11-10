/** Control characters, or a backslash: browsers read `/\evil.com` as the protocol-relative `//evil.com`. */
export const hasUnsafeRedirectChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)

    if (code < 0x20 || code === 0x7f) return true
  }

  return value.includes('\\')
}

/** Only an in-app path survives; anything that could leave the origin becomes `/`. */
export const sanitizeRedirectUrl = (input: string | undefined | null): string => {
  if (!input || input.length > 2048 || hasUnsafeRedirectChars(input)) return '/'

  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('//')) return '/'

  if (input.includes(':')) return '/'

  return input.startsWith('/') ? input : `/${input}`
}
