import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GATE_DEADLINE_MS,
  __resetGlobalBudgetCache,
  admitDailyBudget,
  admitDailyRun,
  admitDailySpend,
} from '../lambda/usage.js'
import type { UsageStore } from '../ports.js'

// A query stalled on a pooled connection: the deadline is what ends it.
const hang = async () => {
  return new Promise<never>(() => {})
}

const usage: UsageStore = { globalDay: hang, countRun: hang, day: hang, customerExists: hang }
const dropConnections = vi.fn<() => void>()

describe('the quota deadline', () => {
  beforeEach(() => {
    __resetGlobalBudgetCache()
    dropConnections.mockClear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops the pool when the gate before the runtime stalls', async () => {
    const pending = admitDailySpend('cust-1', { usage, dropConnections })

    await vi.advanceTimersByTimeAsync(GATE_DEADLINE_MS)

    expect(await pending).toBe('unavailable')
    await vi.waitFor(() => {
      expect(dropConnections).toHaveBeenCalledTimes(1)
    })
  })

  // An agent tool checks the budget mid-run: closing the shared pool would cut the run's own queries.
  it('keeps the pool when a check made inside a run stalls', async () => {
    const budget = admitDailyBudget('cust-1', { usage })
    const counted = admitDailyRun('cust-1', 'run-1', { usage })

    await vi.advanceTimersByTimeAsync(GATE_DEADLINE_MS)

    expect(await budget).toBe('unavailable')
    expect(await counted).toBe('unavailable')

    vi.useRealTimers()
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })

    expect(dropConnections).not.toHaveBeenCalled()
  })
})
