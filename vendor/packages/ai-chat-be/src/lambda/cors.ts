/* eslint-disable node/prefer-global/process */

// Echoes the request Origin only when it matches the ALLOWED_ORIGINS env allow-list.
// ALLOWED_ORIGINS is comma-separated; '*' disables the allow-list (legacy/dev escape hatch).
export const resolveCorsOrigin = (requestOrigin: string | undefined): string | null => {
  // eslint-disable-next-line dot-notation
  const raw = process.env['ALLOWED_ORIGINS']

  if (!raw) return null

  if (raw.trim() === '*') return '*'

  if (!requestOrigin) return null

  const allowList = raw
    .split(',')
    .map((origin) => {
      return origin.trim()
    })
    .filter(Boolean)

  return allowList.includes(requestOrigin) ? requestOrigin : null
}

export const extractRequestOrigin = (headers: Record<string, string | undefined> | undefined): string | undefined => {
  if (!headers) return undefined

  // eslint-disable-next-line dot-notation
  return headers['origin'] ?? headers['Origin']
}

export const buildCorsHeaders = (
  headersOrOrigin: Record<string, string | undefined> | string | undefined,
  options: { allowMethods?: string; allowHeaders?: string; exposeHeaders?: string } = {},
): Record<string, string> => {
  const requestOrigin =
    typeof headersOrOrigin === 'string' || headersOrOrigin === undefined
      ? headersOrOrigin
      : extractRequestOrigin(headersOrOrigin)

  const origin = resolveCorsOrigin(requestOrigin)

  if (!origin) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': options.allowMethods ?? 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': options.allowHeaders ?? 'Content-Type, Authorization',
    ...(options.exposeHeaders === undefined ? {} : { 'Access-Control-Expose-Headers': options.exposeHeaders }),
    Vary: 'Origin',
  }
}
