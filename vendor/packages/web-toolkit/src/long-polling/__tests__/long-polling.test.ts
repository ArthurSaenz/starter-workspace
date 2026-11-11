import { afterEach, describe, expect, it, vi } from 'vitest'

import { poll } from '..'

const counter = () => {
  let calls = 0

  return vi.fn(async () => {
    calls += 1

    return calls
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('poll', () => {
  it('calls fn every interval while the condition holds and returns the first result that ends it', async () => {
    vi.useFakeTimers()

    const fn = counter()

    const pending = poll({
      fn,
      condition: (n) => {
        return n < 3
      },
      intervalMs: 100,
    })

    await vi.advanceTimersByTimeAsync(199)
    expect(fn).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(3)
  })

  it('stops after maxAttempts retries with the last result', async () => {
    vi.useFakeTimers()

    const fn = counter()

    const pending = poll({
      fn,
      condition: () => {
        return true
      },
      intervalMs: 10,
      maxAttempts: 2,
    })

    await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toBe(3)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('waits firstDelayMs before the first call', async () => {
    vi.useFakeTimers()

    const fn = counter()

    const pending = poll({
      fn,
      condition: () => {
        return false
      },
      intervalMs: 10,
      firstDelayMs: 500,
    })

    await vi.advanceTimersByTimeAsync(499)
    expect(fn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(1)
  })

  describe('with a signal', () => {
    it('rejects with the AbortError as soon as it is aborted between calls', async () => {
      vi.useFakeTimers()

      const fn = counter()
      const controller = new AbortController()

      const pending = poll({
        fn,
        condition: () => {
          return true
        },
        intervalMs: 1000,
        signal: controller.signal,
      })

      await vi.advanceTimersByTimeAsync(1500)
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('rejects when aborted during the call that ends the polling', async () => {
      const controller = new AbortController()

      await expect(
        poll({
          fn: async () => {
            controller.abort()

            return 1
          },
          condition: () => {
            return false
          },
          intervalMs: 10,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('never calls fn when already aborted', async () => {
      const fn = counter()
      const reason = new Error('left the page')

      await expect(
        poll({
          fn,
          condition: () => {
            return true
          },
          intervalMs: 10,
          signal: AbortSignal.abort(reason),
        }),
      ).rejects.toBe(reason)
      await expect(
        poll({
          fn,
          condition: () => {
            return true
          },
          intervalMs: 10,
          firstDelayMs: 10,
          signal: AbortSignal.abort(reason),
        }),
      ).rejects.toBe(reason)
      expect(fn).not.toHaveBeenCalled()
    })

    it('resolves as usual when never aborted', async () => {
      vi.useFakeTimers()

      const pending = poll({
        fn: counter(),
        condition: (n) => {
          return n < 2
        },
        intervalMs: 10,
        signal: new AbortController().signal,
      })

      await vi.advanceTimersByTimeAsync(10)
      await expect(pending).resolves.toBe(2)
    })
  })
})
