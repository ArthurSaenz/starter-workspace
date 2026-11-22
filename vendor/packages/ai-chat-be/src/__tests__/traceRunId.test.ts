import { describe, expect, it } from 'vitest'

import { traceRunIdOf } from '../copilotkit/traceRunId.js'

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/

describe('traceRunIdOf', () => {
  it('is a v4-shaped UUID, the same for the same turn', () => {
    const id = traceRunIdOf('cust-1', 'thread-1', 'run-1')

    expect(id).toMatch(UUID_V4)
    expect(traceRunIdOf('cust-1', 'thread-1', 'run-1')).toBe(id)
  })

  it('differs per owner, thread and run, so a browser cannot aim at another traveller’s trace', () => {
    const ids = new Set([
      traceRunIdOf('cust-1', 'thread-1', 'run-1'),
      traceRunIdOf('cust-2', 'thread-1', 'run-1'),
      traceRunIdOf('cust-1', 'thread-2', 'run-1'),
      traceRunIdOf('cust-1', 'thread-1', 'run-2'),
    ])

    expect(ids.size).toBe(4)
  })
})
