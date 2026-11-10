import type { HeaderBag } from './headers.js'
import { readHeader } from './headers.js'

export interface CookieOptions {
  accessName?: string
  refreshName?: string
  accessPath?: string
  /**
   * Must cover the refresh and logout routes or the browser never sends the refresh cookie there.
   * Behind an `/api/v1` mount a bare `/auth` would not match `/api/v1/auth/refresh`, so refresh
   * would fail silently.
   */
  refreshPath?: string
}

export type ResolvedCookieOptions = Required<CookieOptions>

const BEARER_PREFIX = 'Bearer '

export const resolveCookieOptions = (options: CookieOptions = {}): ResolvedCookieOptions => {
  return {
    accessName: options.accessName ?? 'access_token',
    refreshName: options.refreshName ?? 'refresh_token',
    accessPath: options.accessPath ?? '/',
    refreshPath: options.refreshPath ?? '/api/v1/auth',
  }
}

const buildCookie = (name: string, value: string, path: string, maxAgeSec: number): string => {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAgeSec}`
}

export const buildAccessCookie = (cookies: ResolvedCookieOptions, token: string, maxAgeSec: number): string => {
  return buildCookie(cookies.accessName, token, cookies.accessPath, maxAgeSec)
}

export const buildRefreshCookie = (cookies: ResolvedCookieOptions, token: string, maxAgeSec: number): string => {
  return buildCookie(cookies.refreshName, token, cookies.refreshPath, maxAgeSec)
}

export const buildClearCookies = (cookies: ResolvedCookieOptions): string[] => {
  return [
    buildCookie(cookies.accessName, '', cookies.accessPath, 0),
    buildCookie(cookies.refreshName, '', cookies.refreshPath, 0),
  ]
}

export const parseCookieHeader = (header: string | undefined): Record<string, string> => {
  const result: Record<string, string> = {}

  if (!header) return result

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')

    if (eq === -1) continue

    const name = part.slice(0, eq).trim()

    if (!name) continue

    // Our tokens never contain `%`; a malformed escape from a hand-built cookie is no cookie, not a 500.
    try {
      result[name] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      continue
    }
  }

  return result
}

/** Cookie first (the browser path); a bearer header serves server-side callers and tests. */
export const extractAccessToken = (headers: HeaderBag, cookieName = 'access_token'): string | null => {
  const fromCookie = parseCookieHeader(readHeader(headers, 'cookie'))[cookieName]

  if (fromCookie) return fromCookie

  const authorization = readHeader(headers, 'authorization')

  if (authorization?.startsWith(BEARER_PREFIX)) {
    return authorization.slice(BEARER_PREFIX.length).trim() || null
  }

  return null
}

export const extractRefreshToken = (headers: HeaderBag, cookieName = 'refresh_token'): string | null => {
  return parseCookieHeader(readHeader(headers, 'cookie'))[cookieName] || null
}
