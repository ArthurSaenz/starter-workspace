import crypto from 'node:crypto'

/** 32 random bytes, base64url: a `state`, a `nonce`, or a PKCE verifier (43 chars, within RFC 7636's 43–128). */
export const randomUrlToken = (): string => {
  return crypto.randomBytes(32).toString('base64url')
}

export const pkceChallenge = (verifier: string): string => {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}
