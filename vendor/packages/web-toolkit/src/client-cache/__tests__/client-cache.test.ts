import { afterEach, describe, expect, it, vi } from 'vitest'

import { clientCache } from '..'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('clientCache', () => {
  it('round-trips a value and records when it was saved', () => {
    clientCache.saveSync('user', { id: 1 }, '1000')

    expect(clientCache.load('user')).toEqual({ id: 1 })
    expect(localStorage.getItem('v1.user.updatedAt')).toBe('1000')
    expect(clientCache.isExist('user')).toBe(true)
  })

  it('deletes the entry when saving undefined', () => {
    clientCache.saveSync('user', { id: 1 })
    clientCache.saveSync('user', undefined)

    expect(localStorage.getItem('v1.user')).toBeNull()
    expect(clientCache.isExist('user')).toBe(false)
  })

  it('saves on the next tick with save()', () => {
    vi.useFakeTimers()
    clientCache.save('later', 1)

    expect(clientCache.load('later')).toBeUndefined()

    vi.advanceTimersByTime(1)

    expect(clientCache.load('later')).toBe(1)
  })

  it('returns undefined for a missing or corrupt value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    localStorage.setItem('v1.broken', '{')

    expect(clientCache.load('missing')).toBeUndefined()
    expect(clientCache.load('broken')).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('tells fresh entries from stale ones', () => {
    clientCache.saveSync('fresh', 1)
    clientCache.saveSync('stale', 1, String(Date.now() - 10_000))

    expect(clientCache.isExistAndFresh('fresh', 5)).toBe(true)
    expect(clientCache.isExistAndFresh('stale', 5)).toBe(false)
    expect(clientCache.isExistAndFresh('missing', 5)).toBe(false)
  })

  it('imports without throwing when localStorage access is denied', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Access is denied', 'SecurityError')
      },
    })

    try {
      const path = '../client-cache.ts?denied'
      const blocked = (await import(/* @vite-ignore */ path)) as typeof clientCache

      blocked.saveSync('user', 1)

      expect(blocked.load('user')).toBeUndefined()
    } finally {
      Object.defineProperty(window, 'localStorage', descriptor)
    }
  })
})
