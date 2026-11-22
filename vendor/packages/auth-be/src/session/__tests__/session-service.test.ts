/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/assertions-in-tests -- fixture client IPs; `expectAuthError` asserts, and the rule does not follow helpers */
import jwt from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'

import { cookieValue, expectAuthError, signIn } from '../../__tests__/helpers/engine.js'
import {
  ACCESS_SECRET,
  IDENTITY,
  REFRESH_SECRET,
  createFakes,
  invitedUser,
  tokenFromEmail,
} from '../../__tests__/helpers/fakes.js'
import { createMagicLinkAuth } from '../../create-auth.js'
import { AuthError } from '../../errors.js'
import type { HeaderBag } from '../../http/headers.js'
import type { SessionStore } from '../../ports.js'
import { hashToken, signRefreshToken } from '../../tokens.js'

describe('refreshSession', () => {
  it('rotates: a new pair, the old refresh token dead', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    const next = await auth.refreshSession({ refreshToken: result.refreshToken, ipAddress: '1.1.1.1' })

    expect(next.refreshToken).not.toBe(result.refreshToken)
    expect(cookieValue(next.refreshCookie!)).toBe(next.refreshToken)
    expect(fakes.sessions).toHaveLength(2)
  })

  it('answers both of two concurrent refreshes with one cookie: the loser gets access to the winner session', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    const [first, second] = await Promise.all([
      auth.refreshSession({ refreshToken: result.refreshToken }),
      auth.refreshSession({ refreshToken: result.refreshToken }),
    ])

    expect(first.refreshCookie).toBeDefined()
    expect(second).toEqual({ accessToken: expect.any(String), accessCookie: expect.stringMatching(/^access_token=/) })
    expect(jwt.verify(second.accessToken, ACCESS_SECRET, IDENTITY)).toMatchObject({ sub: 'u1' })
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
    expect(
      fakes.sessions.filter((session) => {
        return !session.revokedAt
      }),
    ).toHaveLength(1)
  })

  it('answers a refresh that arrives just after its token was rotated with access to the successor', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const next = await auth.refreshSession({ refreshToken: result.refreshToken })

    const late = await auth.refreshSession({ refreshToken: result.refreshToken })

    expect(late.refreshCookie).toBeUndefined()
    expect(late.accessCookie).toMatch(/^access_token=/)
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
    await expect(auth.refreshSession({ refreshToken: next.refreshToken! })).resolves.toHaveProperty('refreshCookie')
  })

  it('logs a grace answer with the user and both session ids, and no token material', async () => {
    const fakes = createFakes([invitedUser()])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { auth, result } = await signIn(fakes)

    await auth.refreshSession({ refreshToken: result.refreshToken })
    await auth.refreshSession({ refreshToken: result.refreshToken }, { logger })

    expect(logger.warn).toHaveBeenCalledWith('Refresh answered from the grace window with a rotated token', {
      data: { userId: 'u1', rotatedSessionId: '1', successorSessionId: '2' },
    })
  })

  it.each<[string, (fakes: ReturnType<typeof createFakes>) => void]>([
    [
      'the successor was logged out',
      (fakes) => {
        fakes.sessions[1]!.revokedAt = new Date()
      },
    ],
    [
      'the successor expired',
      (fakes) => {
        fakes.sessions[1]!.expiresAt = new Date(Date.now() - 1000)
      },
    ],
    [
      'the user was deleted',
      (fakes) => {
        fakes.users.delete('u1')
      },
    ],
    [
      'the invite was revoked',
      (fakes) => {
        fakes.users.get('u1')!.invited = false
      },
    ],
    [
      'the rotation is past the grace window',
      (fakes) => {
        fakes.sessions[0]!.revokedAt = new Date(Date.now() - 31_000)
      },
    ],
    [
      'the rotation time does not parse',
      (fakes) => {
        fakes.sessions[0]!.revokedAt = 'not a date'
      },
    ],
  ])('treats a replay as theft when %s', async (_label, arrange) => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    await auth.refreshSession({ refreshToken: result.refreshToken })
    arrange(fakes)

    await expect(auth.refreshSession({ refreshToken: result.refreshToken })).rejects.toBeInstanceOf(AuthError)
    expect(fakes.sessionStore.revokeAllForUser).toHaveBeenCalledWith('u1', undefined)
  })

  it('has no grace window when refreshGraceSec is 0', async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth({ ...fakes.config, jwt: { ...fakes.config.jwt, refreshGraceSec: 0 } })

    await auth.requestMagicLink({ email: 'ada@example.com' })

    const { refreshToken } = await auth.verifyMagicLink({ rawToken: tokenFromEmail(fakes.sent[0]!) })

    const outcomes = await Promise.allSettled([
      auth.refreshSession({ refreshToken }),
      auth.refreshSession({ refreshToken }),
    ])

    expect(
      outcomes.map((outcome) => {
        return outcome.status
      }),
    ).toEqual(['fulfilled', 'rejected'])
    expect(fakes.sessionStore.findSuccessor).not.toHaveBeenCalled()
  })

  it('treats a replayed refresh token as theft and revokes every session of the user', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const next = await auth.refreshSession({ refreshToken: result.refreshToken })

    fakes.sessions[0]!.revokedAt = new Date(Date.now() - 31_000)

    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    await expectAuthError(auth.refreshSession({ refreshToken: next.refreshToken! }), 'INVALID_REFRESH_TOKEN', 401)
    expect(fakes.sessionStore.revokeAllForUser).toHaveBeenCalledWith('u1', undefined)
  })

  it('a replayed token two rotations old still revokes every session', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const next = await auth.refreshSession({ refreshToken: result.refreshToken })

    await auth.refreshSession({ refreshToken: next.refreshToken! })
    fakes.sessions[0]!.revokedAt = new Date(Date.now() - 31_000)

    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    expect(fakes.sessionStore.revokeAllForUser).toHaveBeenCalledWith('u1', undefined)
    expect(
      fakes.sessions.every((session) => {
        return Boolean(session.revokedAt)
      }),
    ).toBe(true)
  })

  it("a refresh racing a logout fails alone and leaves the user's other sessions alive", async () => {
    const fakes = createFakes([invitedUser()])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const first = await signIn(fakes)

    await signIn(fakes)
    await first.auth.logout(first.result.refreshToken)

    await expectAuthError(
      first.auth.refreshSession({ refreshToken: first.result.refreshToken }, { logger }),
      'INVALID_REFRESH_TOKEN',
      401,
    )
    expect(fakes.sessions[1]!.revokedAt).toBeNull()
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Refresh with a revoked, never-rotated token', { data: { userId: 'u1' } })
  })

  it('a replayed rotated token whose successor row was pruned fails alone', async () => {
    const fakes = createFakes([invitedUser()])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { auth, result } = await signIn(fakes)

    await auth.refreshSession({ refreshToken: result.refreshToken })
    fakes.sessions.splice(1, 1)

    await expectAuthError(
      auth.refreshSession({ refreshToken: result.refreshToken }, { logger }),
      'INVALID_REFRESH_TOKEN',
      401,
    )
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Refresh with a revoked, never-rotated token', { data: { userId: 'u1' } })
  })

  it('refuses a session row whose userId differs from the token subject', async () => {
    const fakes = createFakes([invitedUser(), invitedUser({ id: 'u2', email: 'bob@example.com' })])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { auth, result } = await signIn(fakes)

    await signIn(fakes, 'bob@example.com')
    fakes.sessionStore.findByTokenHash.mockResolvedValueOnce(fakes.sessions[1]!)

    await expectAuthError(
      auth.refreshSession({ refreshToken: result.refreshToken }, { logger }),
      'INVALID_REFRESH_TOKEN',
      401,
    )
    expect(fakes.sessionStore.rotate).not.toHaveBeenCalled()
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('Refresh token subject does not match its session row', {
      data: { sessionId: '2' },
    })
  })

  it('refuses a revoked, rotated session row of another user inside the grace window', async () => {
    const fakes = createFakes([invitedUser(), invitedUser({ id: 'u2', email: 'bob@example.com' })])
    const { auth, result } = await signIn(fakes)
    const bob = await signIn(fakes, 'bob@example.com')

    await bob.auth.refreshSession({ refreshToken: bob.result.refreshToken })
    fakes.sessionStore.findByTokenHash.mockResolvedValueOnce(fakes.sessions[1]!)

    await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    expect(fakes.sessionStore.findSuccessor).not.toHaveBeenCalled()
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
  })

  it('refuses a grace successor of another user', async () => {
    const fakes = createFakes([invitedUser(), invitedUser({ id: 'u2', email: 'bob@example.com' })])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { auth, result } = await signIn(fakes)

    await auth.refreshSession({ refreshToken: result.refreshToken })
    await signIn(fakes, 'bob@example.com')
    fakes.sessionStore.findSuccessor.mockResolvedValueOnce(fakes.sessions[2]!)

    await expectAuthError(
      auth.refreshSession({ refreshToken: result.refreshToken }, { logger }),
      'INVALID_REFRESH_TOKEN',
      401,
    )
    expect(fakes.sessionStore.revokeAllForUser).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('Refresh token subject does not match its session row', {
      data: { sessionId: '1', successorSessionId: '3' },
    })
  })

  it('accepts a session row whose userId is a non-string id equal to the subject', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)

    fakes.sessionStore.findByTokenHash.mockResolvedValueOnce({
      ...fakes.sessions[0]!,
      userId: {
        toString: () => {
          return 'u1'
        },
      } as never,
    })

    await expect(auth.refreshSession({ refreshToken: result.refreshToken })).resolves.toHaveProperty('refreshCookie')
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

  it.each<[string, (auth: Awaited<ReturnType<typeof signIn>>['auth'], headers: HeaderBag) => Promise<unknown>]>([
    [
      'authenticate',
      (auth, headers) => {
        return auth.authenticate(headers)
      },
    ],
    [
      'getMe',
      (auth, headers) => {
        return auth.getMe(auth.requireUser(headers))
      },
    ],
  ])('%s refuses a signed-in user whose invite was revoked and ends their sessions', async (_label, read) => {
    const fakes = createFakes([invitedUser()])
    const first = await signIn(fakes)
    const second = await signIn(fakes)

    fakes.users.get('u1')!.invited = false

    await expectAuthError(read(first.auth, { cookie: `access_token=${first.result.accessToken}` }), 'NOT_INVITED', 403)
    expect(fakes.sessions).toHaveLength(2)
    expect(
      fakes.sessions.every((session) => {
        return session.revokedAt
      }),
    ).toBe(true)

    for (const { auth, result } of [first, second]) {
      await expectAuthError(auth.refreshSession({ refreshToken: result.refreshToken }), 'INVALID_REFRESH_TOKEN', 401)
    }
  })

  it('a failed revoke still answers NOT_INVITED', async () => {
    const fakes = createFakes([invitedUser()])
    const { auth, result } = await signIn(fakes)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    fakes.users.get('u1')!.invited = false
    fakes.sessionStore.revokeAllForUser.mockRejectedValueOnce(new Error('db down'))

    await expectAuthError(
      auth.authenticate({ cookie: `access_token=${result.accessToken}` }, { logger }),
      'NOT_INVITED',
      403,
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'Authenticated request by a user who may no longer sign in; revoking every session',
      { data: { userId: 'u1' } },
    )
    expect(logger.error).toHaveBeenCalledWith('Failed to revoke the sessions of a user who may no longer sign in', {
      data: { name: 'Error' },
    })
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

describe('sign-in method', () => {
  const methodOf = (token: string, secret: string): unknown => {
    return (jwt.verify(token, secret, IDENTITY) as { authMethod?: unknown }).authMethod
  }

  const googleSession = async () => {
    const fakes = createFakes([invitedUser()])
    const auth = createMagicLinkAuth(fakes.config)
    const pair = await auth.issueSession(invitedUser(), {}, undefined, { authMethod: 'google' })

    return { fakes, auth, pair }
  }

  it('issueSession with authMethod google mints access and refresh tokens that say google', async () => {
    const { pair } = await googleSession()

    expect(methodOf(pair.accessToken, ACCESS_SECRET)).toBe('google')
    expect(methodOf(pair.refreshToken, REFRESH_SECRET)).toBe('google')
  })

  it('rotation keeps the method of the session it rotates', async () => {
    const { auth, pair } = await googleSession()

    const next = await auth.refreshSession({ refreshToken: pair.refreshToken })

    expect(methodOf(next.accessToken, ACCESS_SECRET)).toBe('google')
    expect(methodOf(next.refreshToken!, REFRESH_SECRET)).toBe('google')
  })

  it('a grace answer keeps the method', async () => {
    const { fakes, auth, pair } = await googleSession()

    await auth.refreshSession({ refreshToken: pair.refreshToken })

    const late = await auth.refreshSession({ refreshToken: pair.refreshToken })

    // A stale read of the rotated row sends the refresh down the lost-race path instead.
    fakes.sessionStore.findByTokenHash.mockResolvedValueOnce({ ...fakes.sessions[0]!, revokedAt: null })

    const raced = await auth.refreshSession({ refreshToken: pair.refreshToken })

    expect(late.refreshToken).toBeUndefined()
    expect(raced.refreshToken).toBeUndefined()
    expect(methodOf(late.accessToken, ACCESS_SECRET)).toBe('google')
    expect(methodOf(raced.accessToken, ACCESS_SECRET)).toBe('google')
  })

  const rotateHandSigned = async (refreshToken: string) => {
    const fakes = createFakes([invitedUser()])

    await fakes.sessionStore.create({
      userId: 'u1',
      tokenHash: hashToken(refreshToken),
      jti: 'hand-signed',
      expiresAt: new Date(Date.now() + 60_000),
    })

    return createMagicLinkAuth(fakes.config).refreshSession({ refreshToken })
  }

  it('a refresh token without the claim rotates as magic', async () => {
    const next = await rotateHandSigned(
      signRefreshToken({ sub: 'u1', jti: 'hand-signed' }, REFRESH_SECRET, IDENTITY).token,
    )

    expect(methodOf(next.accessToken, ACCESS_SECRET)).toBe('magic')
    expect(methodOf(next.refreshToken!, REFRESH_SECRET)).toBe('magic')
  })

  it('an unknown authMethod claim reads as magic', async () => {
    const next = await rotateHandSigned(
      jwt.sign({ sub: 'u1', jti: 'hand-signed', authMethod: 'saml' }, REFRESH_SECRET, {
        algorithm: 'HS256',
        ...IDENTITY,
      }),
    )

    expect(methodOf(next.accessToken, ACCESS_SECRET)).toBe('magic')
    expect(methodOf(next.refreshToken!, REFRESH_SECRET)).toBe('magic')
  })
})
