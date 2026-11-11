import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestIdleCallback fallback', () => {
  it('runs the callback on a timer where the browser has no idle callbacks', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.stubGlobal('cancelIdleCallback', undefined)

    const path = '../request-idle-callback.ts?fallback'
    const fallback = (await import(/* @vite-ignore */ path)) as typeof import('../request-idle-callback')

    const deadline = await new Promise<IdleDeadline>((resolve) => {
      fallback.requestIdleCallback(resolve)
    })

    expect(deadline.didTimeout).toBe(false)
    expect(deadline.timeRemaining()).toBeGreaterThanOrEqual(0)

    const cancelled = vi.fn()

    fallback.cancelIdleCallback(fallback.requestIdleCallback(cancelled))
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })

    expect(cancelled).not.toHaveBeenCalled()
  })
})
