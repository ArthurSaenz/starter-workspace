import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { debounce } from '../filters/lib/debounce'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses a burst of calls into one call with the last arguments', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    vi.advanceTimersByTime(50)
    debounced('b')
    vi.advanceTimersByTime(99)

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('drops the pending call on cancel and still accepts later calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    debounced.cancel()
    vi.advanceTimersByTime(200)

    expect(fn).not.toHaveBeenCalled()

    debounced.cancel()
    debounced('b')
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
  })
})
