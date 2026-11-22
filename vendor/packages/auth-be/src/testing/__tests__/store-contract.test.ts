import { describe, expect, it } from 'vitest'

import { createFakes } from '../../__tests__/helpers/fakes.js'
import type { NewSession, StoredMagicToken, StoredSession } from '../../ports.js'
import type { StoreContractCase } from '../index.js'
import { magicTokenStoreContract, rateLimiterContract, sessionStoreContract } from '../index.js'

const caseNamed = <TStore>(cases: StoreContractCase<TStore>[], name: string): StoreContractCase<TStore> => {
  const found = cases.find((contractCase) => {
    return contractCase.name === name
  })

  if (!found) throw new Error(`no contract case named ${name}`)

  return found
}

describe('the kit passes the reference fakes', () => {
  it.each(
    magicTokenStoreContract.map((contractCase) => {
      return [contractCase.name, contractCase] as const
    }),
  )('magic tokens: %s', async (_name, contractCase) => {
    await expect(
      contractCase.run(() => {
        return createFakes().magicTokens
      }),
    ).resolves.toBeUndefined()
  })

  it.each(
    sessionStoreContract.map((contractCase) => {
      return [contractCase.name, contractCase] as const
    }),
  )('sessions: %s', async (_name, contractCase) => {
    await expect(
      contractCase.run(async () => {
        return createFakes().sessionStore
      }),
    ).resolves.toBeUndefined()
  })

  it.each(
    rateLimiterContract.map((contractCase) => {
      return [contractCase.name, contractCase] as const
    }),
  )('rate limiter: %s', async (_name, contractCase) => {
    await expect(
      contractCase.run(() => {
        return createFakes().rateLimiter
      }),
    ).resolves.toBeUndefined()
  })
})

describe('broken stores', () => {
  it('catches a rotate that is not atomic', async () => {
    const { sessionStore, sessions } = createFakes()

    const broken = {
      ...sessionStore,
      rotate: async (oldId: string, next: NewSession): Promise<StoredSession | null> => {
        const old = sessions.find((session) => {
          return session.id === oldId
        })

        if (!old || old.revokedAt) return null

        await Promise.resolve()
        old.revokedAt = new Date()

        return sessionStore.create(next)
      },
    }

    await expect(
      caseNamed(
        sessionStoreContract,
        '10 concurrent rotates of one id: exactly one wins and one successor row exists',
      ).run(() => {
        return broken
      }),
    ).rejects.toThrow('Store contract: exactly one rotate resolves a row')
  })

  it('catches a release that resurrects a superseded token', async () => {
    const { magicTokens, tokens } = createFakes()

    const broken = {
      ...magicTokens,
      release: async (tokenHash: string, _record: StoredMagicToken) => {
        for (const token of tokens) if (token.tokenHash === tokenHash) token.spent = false
      },
    }

    await expect(
      caseNamed(magicTokenStoreContract, 'release after a newer token for the same email leaves the old one dead').run(
        () => {
          return broken
        },
      ),
    ).rejects.toThrow('Store contract: a superseded token stays dead after release')
  })

  it('catches a consume that is not single-use', async () => {
    const { magicTokens, tokens } = createFakes()

    const broken = {
      ...magicTokens,
      consumeByHash: async (tokenHash: string): Promise<StoredMagicToken | null> => {
        const row = tokens.find((token) => {
          return token.tokenHash === tokenHash
        })

        return row ? { email: row.email, expiresAt: row.expiresAt! } : null
      },
    }

    await expect(
      caseNamed(magicTokenStoreContract, 'consumeByHash returns a created token once').run(() => {
        return broken
      }),
    ).rejects.toThrow('Store contract: a second consume returns null')
    await expect(
      caseNamed(magicTokenStoreContract, '10 concurrent consumes return the token exactly once').run(() => {
        return broken
      }),
    ).rejects.toThrow('Store contract: exactly one consume wins, got 10')
  })

  it('catches a findByTokenHash that hides revoked rows', async () => {
    const { sessionStore } = createFakes()

    const broken = {
      ...sessionStore,
      findByTokenHash: async (tokenHash: string): Promise<StoredSession | null> => {
        const row = await sessionStore.findByTokenHash(tokenHash)

        return row?.revokedAt ? null : row
      },
    }

    await expect(
      caseNamed(sessionStoreContract, 'findByTokenHash returns a revoked row with revokedAt set').run(() => {
        return broken
      }),
    ).rejects.toThrow('Store contract: a revoked row is returned with revokedAt')
  })

  it('catches a findSuccessor that never answers', async () => {
    const { sessionStore } = createFakes()

    const broken = {
      ...sessionStore,
      findSuccessor: async (): Promise<StoredSession | null> => {
        return null
      },
    }

    await expect(
      caseNamed(
        sessionStoreContract,
        'findSuccessor returns the successor while findByTokenHash(old) still returns old',
      ).run(() => {
        return broken
      }),
    ).rejects.toThrow('Store contract: findSuccessor returns the rotated-in row')
  })
})
