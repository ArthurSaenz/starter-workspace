export interface RequestMeta {
  ipAddress?: string
  userAgent?: string
}

export interface RefreshSessionInput extends RequestMeta {
  refreshToken: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  accessCookie: string
  refreshCookie: string
}

/**
 * A refresh answered inside the grace window: a fresh access token for the session that won the
 * rotation, and no refresh cookie, because the winner's response already sets it.
 */
export interface AccessOnlyPair {
  accessToken: string
  accessCookie: string
  refreshToken?: undefined
  refreshCookie?: undefined
}

export type RefreshResult = TokenPair | AccessOnlyPair

/** Only the fields that are set, so a store never receives an explicit `undefined` or `null`. */
export const withMeta = (meta: { ipAddress?: string | null; userAgent?: string | null } | undefined): RequestMeta => {
  return {
    ...(meta?.ipAddress ? { ipAddress: meta.ipAddress } : {}),
    ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
  }
}
