/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/assertions-in-tests -- fixture client IPs; `expectAuthError` asserts, and the rule does not follow helpers */
import { describe, expect, it, vi } from 'vitest'

import { cookieValue, expectAuthError, signIn } from '../../__tests__/helpers/engine.js'
import { IDENTITY, REFRESH_SECRET, createFakes, invitedUser } from '../../__tests__/helpers/fakes.js'
import { AuthError } from '../../errors.js'
import { createMagicLinkAuth } from '../../magicLink/magicLinkAuth.js'
import type { SessionStore } from '../../ports.js'
import { signRefreshToken } from '../../tokens.js'

describe('refreshSession', () => {
  it('rotates: a new pair, the old refresh token dead', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    const next = await auth.refreshSession({ refreshToken: result.refreshToken, ipAddress: '1.1.1.1' })

    expect(next.refreshToken).not.toBe(result.refreshToken)
    expect(cookieValue(next.refreshCookie)).toBe(next.refreshToken)
    expect(fakes.sessions).toHaveLength(2)
  })

  it('treats a replayed refresh token as theft and revokes every session of the user', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const next = await auth.refreshSession({ refreshToken: result.refreshToken })

    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    await expectAuthError(auth.refreshSession({ refreshToken: next.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    expect(fakes.sessionStore.revokeAllForUser).toHaveBeenCalledWith('u1', undefined)
  })

  it('fails only the loser of a concurrent rotation', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    fakes.sessionStore.rotate.mockResolvedValueOnce(null)

    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
  })

  it('logs the lost rotation race and answers 401 through the host error factory', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    fakes.sessionStore.rotate.mockResolvedValueOnce(null)

    await expectAuthError(
      auth.refreshSession({ refreshToken: result.refreshToken }, { logger }),
      'INVALID_REFRESH_TOKEN',
      401,
    )
    expect(logger.warn).toHaveBeenCalledWith('Concurrent refresh lost the rotation race; failing this request only', {
      data: { userId: 'u1' },
    })
  })

  it('types rotate so an adapter must say whether it rotated', () => {
    interface NomadreamSessionRow {
      userId: string
      tokenHash: string
      jti: string
      expiresAt: Date
      ipAddress?: string
      userAgent?: string
      id: string
      createdAt: Date
      revokedAt?: Date | null
      replacedBy?: string | null
    }

    const ok: SessionStore['rotate'] = async (): Promise<NomadreamSessionRow | null> => {
      return null
    }

    // @ts-expect-error a void adapter would fail every refresh
    const bad: SessionStore['rotate'] = async (): Promise<void> => {}

    expect(ok).toBeTypeOf('function')
    expect(bad).toBeTypeOf('function')
  })

  it('ends every session of a user whose invite was revoked', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    fakes.users.get('u1')!.invited = false

    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'NOT_INVITED', 403)
    expect(fakes.sessions[0]!.revokedAt).toBeTruthy()
  })

  it.each([
    ['empty', '', 'UNAUTHENTICATED'],
    ['garbage', 'not-a-jwt', 'INVALID_REFRESH_TOKEN'],
    [
      'unknown session',
      signRefreshToken({ sub: 'u1', jti: 'x' }, REFRESH_SECRET, IDENTITY).token,
      'INVALID_REFRESH_TOKEN',
    ],
  ])('refuses an %s refresh token', async (_label, token, code) => {
    const fakes = createFakes([invitedUser()])

    await expectAuthError(createMagicLinkAuth(fakes.config).refreshSession({ refreshToken: token }), code, 401)
  })

  it('refuses an expired session row and a deleted user', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    fakes.sessions[0]!.expiresAt = new Date(Date.now() - 1000)
    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)

    fakes.sessions[0]!.expiresAt = new Date(Date.now() + 60_000)
    fakes.users.delete('u1')
    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'USER_NOT_FOUND', 401)
  })

  it('refuses a session row whose expiry does not parse', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    fakes.sessions[0]!.expiresAt = 'not a date' as unknown as Date
    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
  })

  it('rate-limits refresh per IP', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    fakes.rateLimiter.limitOverride = 0

    await expectAuthError(
      auth.refreshSession({ refreshToken: result.refreshToken, ipAddress: '1.1.1.1' }),
      'RATE_LIMITED',
      429,
    )
  })
})

describe('session reads', () => {
  it('requireUser reads the cookie first, then a bearer header', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    expect(auth.requireUser({ Cookie: `x=1; access_token=${result.accessToken}` }).sub).toBe('u1')
    expect(auth.requireUser({ authorization: `Bearer ${result.accessToken}` }).sub).toBe('u1')
    expect(() => {
      return auth.requireUser({})
    }).toThrow(AuthError)
    expect(() => {
      return auth.requireUser({ cookie: 'access_token=forged' })
    }).toThrow('Invalid access token')
  })

  it('authenticate and getMe load the current row', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const headers = { cookie: `access_token=${result.accessToken}` }

    expect((await auth.authenticate(headers)).user.name).toBe('Ada')
    expect(await auth.getMe(auth.requireUser(headers))).toEqual({ id: 'u1', email: 'ada@example.com' })

    fakes.users.delete('u1')
    await expectAuthError(auth.authenticate(headers), 'USER_NOT_FOUND', 401)
  })

  it('logout revokes the session and never throws', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    await auth.logout(result.refreshToken)
    expect(fakes.sessions[0]!.revokedAt).toBeTruthy()

    fakes.sessionStore.revokeByTokenHash.mockRejectedValueOnce(new Error('db down'))
    await expect(auth.logout(result.refreshToken)).resolves.toBeUndefined()
    fakes.sessionStore.revokeByTokenHash.mockRejectedValueOnce(undefined)
    await expect(
      auth.logout(result.refreshToken, { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }),
    ).resolves.toBeUndefined()
    await expect(auth.logout(null)).resolves.toBeUndefined()
  })

  it('honours custom cookie names and paths', async () => {
    const fakes = createFakes([invitedUser()])

    fakes.config.cookies = { accessName: 'sid', refreshName: 'rid', refreshPath: '/auth' }

    const { auth, result } = await signIn(fakes)

    expect(result.refreshCookie).toMatch(/^rid=.+; Path=\/auth;/)
    expect(auth.extractRefreshToken({ cookie: `rid=${result.refreshToken}` })).toBe(result.refreshToken)
    expect(auth.extractAccessToken({ cookie: `sid=${result.accessToken}` })).toBe(result.accessToken)
    expect(auth.clearCookies()).toEqual([
      'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      'rid=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0',
    ])
  })
})
