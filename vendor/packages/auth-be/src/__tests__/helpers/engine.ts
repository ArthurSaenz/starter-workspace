import { expect } from 'vitest'

import { AuthError } from '../../errors.js'
import { createMagicLinkAuth } from '../../magic-link/magic-link-auth.js'
import type { createFakes } from './fakes.js'
import { tokenFromEmail } from './fakes.js'

export const cookieValue = (cookie: string): string => {
  return cookie.split(';')[0]!.split('=')[1]!
}

/** The full round trip: request a link, read it out of the fake mailbox, verify it. */
export const signIn = async (fakes: ReturnType<typeof createFakes>, email = 'ada@example.com') => {
  const auth = createMagicLinkAuth(fakes.config)

  await auth.requestMagicLink({ email, redirectUrl: '/trips' })

  return { auth, result: await auth.verifyMagicLink({ rawToken: tokenFromEmail(fakes.sent.at(-1)!) }) }
}

export const expectAuthError = async (promise: Promise<unknown>, code: string, status: number) => {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    return error instanceof AuthError && error.code === code && error.status === status
  })
}
