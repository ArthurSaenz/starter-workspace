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

    await idb.remove('a')
    await idb.remove(`${EXPIRY}b`)

    expect(await keyval.keys()).toEqual([])
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

    await idb.flush()

    expect(await keyval.keys()).toEqual([])
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

  it('rejects remove and flush so the caller can handle the failure', async () => {
    const broken = new DOMException('broken', 'UnknownError')

    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw broken
    })
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => {
      throw broken
    })

    await expect(idb.remove('a')).rejects.toBe(broken)
    await expect(idb.flush()).rejects.toBe(broken)
  })

  it('logs a failed removal of an expired key and still answers null', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await keyval.setMany([
      ['old', 1],
      [`${EXPIRY}old`, Date.now() - 1],
    ])
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new DOMException('broken', 'UnknownError')
    })

    expect(await idb.get('old')).toBeNull()
    await expect
      .poll(() => {
        return error.mock.calls.length
      })
      .toBe(1)
  })

  it('never rejects the expiry sweep when an expired key cannot be removed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await keyval.setMany([
      ['old', 1],
      [`${EXPIRY}old`, Date.now() - 1],
    ])
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new DOMException('broken', 'UnknownError')
    })

    await expect(idb.removeExpiredKeys()).resolves.toBeUndefined()
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
