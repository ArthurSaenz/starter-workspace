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

/** Only the fields that are set, so a store never receives an explicit `undefined` or `null`. */
export const withMeta = (meta: { ipAddress?: string | null; userAgent?: string | null } | undefined): RequestMeta => {
  return {
    ...(meta?.ipAddress ? { ipAddress: meta.ipAddress } : {}),
    ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
  }
}
