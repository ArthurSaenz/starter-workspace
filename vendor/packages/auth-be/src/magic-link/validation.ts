import type { CreateAuthError } from '../errors.js'
import { hasUnsafeRedirectChars } from '../http/redirect.js'
import type { StoredMagicToken } from '../ports.js'
import { toMs } from '../time.js'

export interface RequestValidationInput {
  email: string
  redirectUrl: string | undefined
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const TOKEN_REGEX = /^[a-f0-9]{16,256}$/i

export const defaultValidateRequest = (input: RequestValidationInput): void => {
  if (input.email.length > 320 || !EMAIL_REGEX.test(input.email)) throw new Error('Invalid email')

  if (input.redirectUrl && (input.redirectUrl.length > 2048 || hasUnsafeRedirectChars(input.redirectUrl))) {
    throw new Error('Invalid redirectUrl')
  }
}

export const createDefaultVerifyValidator = (createError: CreateAuthError) => {
  return (input: { rawToken: string }): void => {
    if (!TOKEN_REGEX.test(input.rawToken)) {
      throw createError({ message: 'rawToken must be hex', code: 'INVALID_REQUEST', status: 400 })
    }
  }
}

/**
 * `consumeByHash` should already skip expired rows; this re-check uses the token's own expiry (so a
 * 72 h invite is honoured) and treats an unparseable timestamp as expired, never as "no expiry".
 * Two hosts sharing one token table would otherwise honour each other's TTLs (a 72 h staff invite
 * redeemed at a 15-minute traveller surface), so no token outlives `maxTokenAgeMs` either.
 */
export const isTokenRecordLive = (record: StoredMagicToken, maxTokenAgeMs: number): boolean => {
  const now = Date.now()
  const expiresAtMs = toMs(record.expiresAt)

  if (!Number.isFinite(expiresAtMs) || now > expiresAtMs) return false

  if (record.createdAt === undefined) return true

  const createdAtMs = toMs(record.createdAt)

  return Number.isFinite(createdAtMs) && now - createdAtMs <= maxTokenAgeMs
}
