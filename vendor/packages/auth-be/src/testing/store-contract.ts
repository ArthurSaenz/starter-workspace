import crypto from 'node:crypto'

import type { MagicTokenStore, NewMagicToken, NewSession, RateLimiter, SessionStore } from '../ports.js'

/**
 * One behaviour the engine relies on from a host store. A host runs every case against its own
 * adapter in its own test runner: `for (const c of sessionStoreContract) it(c.name, () => c.run(makeStore))`.
 */
export interface StoreContractCase<TStore> {
  name: string
  /** Breaking it lets a stolen or replayed token through, rather than failing a sign-in. */
  securityCritical: boolean
  run: (makeStore: () => Promise<TStore> | TStore) => Promise<void>
}

// `never` context: the kit passes none, so a store typed for any host context fits.
type MagicTokens = MagicTokenStore<never>
type Sessions = SessionStore<never>
type Limiter = RateLimiter<never>

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`Store contract: ${message}`)
}

// Random per run, so the cases can share a dev database with other runs.
const unique = (): string => {
  return crypto.randomUUID()
}

const newToken = (email = `${unique()}@contract.test`, expiresAt = new Date(Date.now() + 60_000)): NewMagicToken => {
  return { email, tokenHash: unique(), expiresAt }
}

const newSession = (userId = unique()): NewSession => {
  return { userId, tokenHash: unique(), jti: unique(), expiresAt: new Date(Date.now() + 60_000) }
}

const createSession = async (store: Sessions, data = newSession()): Promise<string> => {
  await store.create(data)

  const row = await store.findByTokenHash(data.tokenHash)

  check(row !== null, 'findByTokenHash returns a created session')

  return String(row!.id)
}

export const magicTokenStoreContract: StoreContractCase<MagicTokens>[] = [
  {
    name: 'consumeByHash returns a created token once',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const token = newToken()

      await store.create(token)

      const first = await store.consumeByHash(token.tokenHash)

      check(first !== null && first.email === token.email, 'the first consume returns the row')
      check((await store.consumeByHash(token.tokenHash)) === null, 'a second consume returns null')
    },
  },
  {
    name: '10 concurrent consumes return the token exactly once',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const token = newToken()

      await store.create(token)

      const results = await Promise.all(
        Array.from({ length: 10 }, () => {
          return store.consumeByHash(token.tokenHash)
        }),
      )

      const winners = results.filter((result) => {
        return result !== null
      })

      check(winners.length === 1, `exactly one consume wins, got ${winners.length}`)
    },
  },
  {
    name: 'consumeByHash after invalidateByEmail returns null',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const token = newToken()

      await store.create(token)
      await store.invalidateByEmail(token.email)

      check((await store.consumeByHash(token.tokenHash)) === null, 'an invalidated token is not consumable')
    },
  },
  {
    name: 'consumeByHash does not return an expired token',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const token = newToken(undefined, new Date(Date.now() - 1000))

      await store.create(token)

      check((await store.consumeByHash(token.tokenHash)) === null, 'an expired token is not consumable')
    },
  },
  {
    name: 'release after a consume re-arms the token',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const token = newToken()

      await store.create(token)

      const record = await store.consumeByHash(token.tokenHash)

      check(record !== null, 'the consume returns the row')
      await store.release(token.tokenHash, record!)
      check((await store.consumeByHash(token.tokenHash)) !== null, 'a released token is consumable again')
    },
  },
  {
    name: 'release after a newer token for the same email leaves the old one dead',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const old = newToken()
      const newer = newToken(old.email)

      await store.create(old)

      const record = await store.consumeByHash(old.tokenHash)

      check(record !== null, 'the consume returns the row')

      // The order the engine uses when a second link is requested while the first sign-in runs.
      await store.invalidateByEmail(old.email)
      await store.create(newer)
      await store.release(old.tokenHash, record!)

      check((await store.consumeByHash(old.tokenHash)) === null, 'a superseded token stays dead after release')
      check((await store.consumeByHash(newer.tokenHash)) !== null, 'the newer token is consumable')
    },
  },
]

export const sessionStoreContract: StoreContractCase<Sessions>[] = [
  {
    name: 'findByTokenHash returns the userId passed to create, as a string, and expiresAt',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()

      await store.create(data)

      const row = await store.findByTokenHash(data.tokenHash)

      check(row !== null, 'findByTokenHash returns a created session')
      check(typeof row!.userId === 'string' && row!.userId === data.userId, 'userId is the string given to create')
      check(Boolean(row!.expiresAt), 'expiresAt is returned')
    },
  },
  {
    name: '10 concurrent rotates of one id: exactly one wins and one successor row exists',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()
      const oldId = await createSession(store, data)

      const successors = Array.from({ length: 10 }, () => {
        return newSession(data.userId)
      })

      const results = await Promise.all(
        successors.map((next) => {
          return store.rotate(oldId, next)
        }),
      )

      const rows = await Promise.all(
        successors.map((next) => {
          return store.findByTokenHash(next.tokenHash)
        }),
      )

      const isPresent = (value: unknown): boolean => {
        return value !== null
      }

      check(results.filter(isPresent).length === 1, 'exactly one rotate resolves a row')
      check(rows.filter(isPresent).length === 1, 'exactly one successor row is written')
    },
  },
  {
    name: 'findByTokenHash returns a revoked row with revokedAt set',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()

      await createSession(store, data)
      await store.revokeByTokenHash(data.tokenHash)

      const row = await store.findByTokenHash(data.tokenHash)

      check(row !== null && Boolean(row.revokedAt), 'a revoked row is returned with revokedAt')
    },
  },
  {
    name: 'after rotate, the old row is returned with revokedAt set',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()
      const oldId = await createSession(store, data)

      check((await store.rotate(oldId, newSession(data.userId))) !== null, 'rotate resolves the successor')

      const old = await store.findByTokenHash(data.tokenHash)

      check(old !== null && Boolean(old.revokedAt), 'the rotated row is returned with revokedAt')
    },
  },
  {
    name: 'findSuccessor returns the successor while findByTokenHash(old) still returns old',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()
      const oldId = await createSession(store, data)
      const successor = await store.rotate(oldId, newSession(data.userId))

      check(successor !== null, 'rotate resolves the successor')

      const found = await store.findSuccessor(oldId)
      const old = await store.findByTokenHash(data.tokenHash)

      check(found !== null && String(found.id) === String(successor!.id), 'findSuccessor returns the rotated-in row')
      check(old !== null && String(old.id) === oldId, 'findByTokenHash still returns the old row')
    },
  },
  {
    name: 'findSuccessor returns a successor that has since been rotated, with revokedAt set',
    securityCritical: true,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()
      const firstId = await createSession(store, data)
      const second = await store.rotate(firstId, newSession(data.userId))

      check(second !== null, 'rotate resolves the successor')
      check((await store.rotate(String(second!.id), newSession(data.userId))) !== null, 'the successor rotates')

      const found = await store.findSuccessor(firstId)

      check(
        found !== null && String(found.id) === String(second!.id) && Boolean(found.revokedAt),
        'findSuccessor returns a revoked successor with revokedAt',
      )
    },
  },
  {
    name: 'findSuccessor of a never-rotated id returns null',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const id = await createSession(store)

      check((await store.findSuccessor(id)) === null, 'a never-rotated id has no successor')
    },
  },
  {
    name: 'rotate of a revoked id returns null',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const data = newSession()
      const id = await createSession(store, data)

      await store.revokeByTokenHash(data.tokenHash)

      check((await store.rotate(id, newSession(data.userId))) === null, 'a revoked id does not rotate')
    },
  },
  {
    name: 'revokeByTokenHash sets revokedAt on that row only',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const revoked = newSession()
      const sibling = newSession(revoked.userId)

      await createSession(store, revoked)
      await createSession(store, sibling)
      await store.revokeByTokenHash(revoked.tokenHash)

      const revokedRow = await store.findByTokenHash(revoked.tokenHash)
      const siblingRow = await store.findByTokenHash(sibling.tokenHash)

      check(revokedRow !== null && Boolean(revokedRow.revokedAt), 'the row is revoked')
      check(siblingRow !== null && !siblingRow.revokedAt, 'a sibling row stays live')
    },
  },
  {
    name: "revokeAllForUser revokes only that user's rows",
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const first = newSession()
      const own = [first, newSession(first.userId)]
      const other = newSession()

      for (const data of [...own, other]) await createSession(store, data)

      await store.revokeAllForUser(first.userId)

      const ownRows = await Promise.all(
        own.map((data) => {
          return store.findByTokenHash(data.tokenHash)
        }),
      )

      const otherRow = await store.findByTokenHash(other.tokenHash)

      check(
        ownRows.every((row) => {
          return row !== null && Boolean(row.revokedAt)
        }),
        'every row of the user is revoked',
      )
      check(otherRow !== null && !otherRow.revokedAt, "another user's row stays live")
    },
  },
]

export const rateLimiterContract: StoreContractCase<Limiter>[] = [
  {
    name: 'allows limit hits in a window and refuses the next',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const key = unique()
      const outcomes: boolean[] = []

      for (let hit = 0; hit < 4; hit++) outcomes.push((await store.incrementAndCheck(key, 3, 60)).allowed)

      check(outcomes.join() === 'true,true,true,false', `hits 1-3 allowed and hit 4 refused, got ${outcomes.join()}`)
    },
  },
  {
    name: 'counts distinct keys independently',
    securityCritical: false,
    run: async (makeStore) => {
      const store = await makeStore()
      const first = unique()

      await store.incrementAndCheck(first, 1, 60)

      check(!(await store.incrementAndCheck(first, 1, 60)).allowed, 'the first key is over its limit')
      check((await store.incrementAndCheck(unique(), 1, 60)).allowed, 'another key is not')
    },
  },
]
