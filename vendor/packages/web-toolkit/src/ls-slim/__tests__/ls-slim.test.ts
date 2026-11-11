import { afterEach, describe, expect, it, vi } from 'vitest'

import { ls } from '..'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('ls', () => {
  it('round-trips a value without a TTL', () => {
    ls.set('plain', { a: 1 })

    expect(ls.get('plain')).toEqual({ a: 1 })
  })

  it('returns null for a missing key', () => {
    expect(ls.get('missing')).toBeNull()
  })

  it('expires a value after its TTL and removes it', () => {
    vi.useFakeTimers()
    ls.set('session', 'abc', 10)

    expect(ls.get('session')).toBe('abc')

    vi.advanceTimersByTime(10_001)

    expect(ls.get('session')).toBeNull()
    expect(localStorage.getItem('session')).toBeNull()
  })

  it('treats a value it cannot parse as absent instead of throwing', () => {
    localStorage.setItem('foreign', 'not json')

    expect(ls.get('foreign')).toBeNull()
    expect(localStorage.getItem('foreign')).toBe('not json')
  })

  it('reports a value it cannot serialize', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const circular: Record<string, unknown> = {}

    circular.self = circular

    expect(ls.set('circular', circular)).toBe(false)
    expect(error).toHaveBeenCalledOnce()
  })

  it('flushes expired TTL entries only, or every TTL entry when forced', () => {
    vi.useFakeTimers()
    ls.set('short', 1, 1)
    ls.set('long', 1, 100)
    ls.set('forever', 1)
    localStorage.setItem('foreign', 'not json')
    localStorage.setItem('empty', '')

    vi.advanceTimersByTime(2000)
    ls.flush()

    expect(Object.keys(localStorage).sort()).toEqual(['empty', 'foreign', 'forever', 'long'])

    ls.flush(true)

    expect(Object.keys(localStorage).sort()).toEqual(['empty', 'foreign', 'forever'])
  })

  it('removes one key or clears everything', () => {
    ls.set('a', 1)
    ls.set('b', 2)

    ls.remove('a')
    expect(ls.get('a')).toBeNull()

    ls.clear()
    expect(localStorage).toHaveLength(0)
  })

  it('degrades to a no-op when localStorage access is denied', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Access is denied', 'SecurityError')
      },
    })

    try {
      const path = '../ls-slim.ts?denied'
      const blocked = (await import(/* @vite-ignore */ path)) as typeof ls

      expect(blocked.set('a', 1)).toBe(false)
      expect(blocked.get('a')).toBeNull()
      expect(blocked.flush()).toBe(false)
      expect(blocked.remove('a')).toBe(false)
      expect(blocked.clear()).toBe(false)
    } finally {
      Object.defineProperty(window, 'localStorage', descriptor)
    }
  })

  it('degrades to a no-op where localStorage does not exist', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!

    Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined })

    try {
      const path = '../ls-slim.ts?missing'
      const missing = (await import(/* @vite-ignore */ path)) as typeof ls

      expect(missing.set('a', 1)).toBe(false)
    } finally {
      Object.defineProperty(window, 'localStorage', descriptor)
    }
  })
})
