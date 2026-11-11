import * as keyval from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { idb } from '..'

const EXPIRY = '__ExpiryTimeStamp__'

beforeEach(async () => {
  await keyval.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('idb', () => {
  it('round-trips a value within its TTL', async () => {
    await idb.set('session', { token: 'abc' }, 60)

    expect(await idb.get('session')).toEqual({ token: 'abc' })
  })

  it('returns null for a missing or expired key and drops the expired one', async () => {
    await keyval.setMany([
      ['old', 1],
      [`${EXPIRY}old`, Date.now() - 1],
    ])

    expect(await idb.get('missing')).toBeNull()
    expect(await idb.get('old')).toBeNull()
    await expect
      .poll(() => {
        return keyval.keys()
      })
      .toEqual([])
  })

  it('reads the expiry entry itself when asked for it', async () => {
    await idb.set('a', 1, 60)

    expect(await idb.get(`${EXPIRY}a`)).toBeGreaterThan(Date.now())
  })

  it('removes the expiry entry together with the value', async () => {
    await idb.set('a', 1, 60)
    await idb.set('b', 1, 60)

    idb.remove('a')
    idb.remove(`${EXPIRY}b`)

    await expect
      .poll(() => {
        return keyval.keys()
      })
      .toEqual([])
  })

  it('leaves the stored entry untouched when the new value cannot be stored', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await idb.set('a', 1, 60)
    const expiry = await keyval.get(`${EXPIRY}a`)

    await idb.set('a', () => {}, 9999)
    await idb.set('b', () => {}, 60)

    expect(error).toHaveBeenCalledTimes(2)
    expect(await keyval.get(`${EXPIRY}a`)).toBe(expiry)
    expect(await keyval.keys()).not.toContain(`${EXPIRY}b`)
  })

  it('sweeps expired keys on every set', async () => {
    await keyval.setMany([
      ['old', 1],
      [`${EXPIRY}old`, Date.now() - 1],
    ])

    await idb.set('fresh', 1, 60)

    await expect
      .poll(() => {
        return keyval.keys()
      })
      .not.toContain('old')
  })

  it('flushes everything', async () => {
    await idb.set('a', 1, 60)

    idb.flush()

    await expect
      .poll(() => {
        return keyval.keys()
      })
      .toEqual([])
  })
})

describe('idb when IndexedDB fails', () => {
  it('answers null instead of rejecting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('broken', 'UnknownError')
    })

    expect(await idb.get('a')).toBeNull()
    expect(error).toHaveBeenCalledOnce()
  })

  it('skips the expiry sweep when keys cannot be listed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.spyOn(IDBObjectStore.prototype, 'getAllKeys').mockImplementation(() => {
      throw new DOMException('broken', 'UnknownError')
    })

    await expect(idb.removeExpiredKeys()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledOnce()
  })
})
