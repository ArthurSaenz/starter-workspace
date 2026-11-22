// LangGraph `interrupt()` ↔ AG-UI interrupts in `InProcessAgent`, against a fake graph: what a
// paused run emits, which checkpoint thread a resume reaches, and that every resume the caller does
// not own is refused with the same fixed message.
import { EventType } from '@ag-ui/client'
import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
import { Command } from '@langchain/langgraph'
import { firstValueFrom, toArray } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod-v4'

import {
  INTERRUPT_TTL_MS,
  InProcessAgent,
  RESUME_ERROR_MESSAGE,
  STALE_SWEEP_INTERVAL_MS,
} from '../copilotkit/inProcessAgent.js'
import type { CheckpointConfig, GraphStateSnapshot, StreamableGraph } from '../copilotkit/inProcessAgent.js'
import { runWithRequestContext } from '../copilotkit/requestContext.js'

const LANGGRAPH_ID = '0123456789abcdef0123456789abcdef'

const CONFIRMATION = {
  kind: 'confirm_trip_plan_change',
  removals: { hotels: [{ hotelId: 'h-1', name: 'Park Hyatt' }], programmes: [] },
  changes: {},
}

const CHECKPOINTED_PLAN = { destination: 'Bangkok', nights: 21, hotels: [], programmes: [] }

interface FakeGraph {
  graph: StreamableGraph
  inputs: unknown[]
  threadIds: unknown[]
  stateReads: unknown[]
}

// `state` is what `getState` answers for every thread; `streamEvents` yields one model end.
const makeGraph = (state: (threadId: unknown) => GraphStateSnapshot): FakeGraph => {
  const fake: FakeGraph = { inputs: [], threadIds: [], stateReads: [], graph: undefined as never }

  fake.graph = {
    streamEvents: (input, options) => {
      const { thread_id: threadId } = options.configurable ?? {}

      fake.inputs.push(input)
      fake.threadIds.push(threadId)

      return (async function* () {
        yield { event: 'on_chat_model_end', data: {} } as never
      })()
    },
    getState: async ({ configurable: { thread_id: threadId } }) => {
      fake.stateReads.push(threadId)

      return state(threadId)
    },
  }

  return fake
}

const paused = (createdAt = new Date().toISOString()): GraphStateSnapshot => {
  return {
    values: { tripPlan: CHECKPOINTED_PLAN },
    createdAt,
    tasks: [{ interrupts: [{ id: LANGGRAPH_ID, value: CONFIRMATION }] }],
  }
}

const finished: GraphStateSnapshot = { values: {}, createdAt: new Date().toISOString(), tasks: [] }
const absent: GraphStateSnapshot = { values: {}, tasks: [] }

const makeCheckpoints = () => {
  const store = {
    deleteThread: vi.fn(async () => {
      return undefined
    }),
    deleteStaleThreads: vi.fn(async () => {
      return undefined
    }),
  }

  const checkpoints: CheckpointConfig = {
    store,
    describeInterrupt: () => {
      return 'Remove Park Hyatt?'
    },
    resumeValue: (entry) => {
      return entry.status === 'resolved' ? entry.payload : { approved: false }
    },
  }

  return { store, checkpoints }
}

const makeAgent = (graph: StreamableGraph, checkpoints?: CheckpointConfig): InProcessAgent => {
  return new InProcessAgent({
    graph,
    graphId: 'travelAiAgent',
    recursionLimit: 8,
    sharedState: {
      keys: ['tripPlan'],
      fromInput: (state) => {
        return { tripPlan: (state as { tripPlan?: unknown } | null)?.tripPlan ?? null }
      },
    },
    ...(checkpoints === undefined ? {} : { checkpoints }),
  })
}

const baseInput = (overrides: Partial<RunAgentInput> = {}): RunAgentInput => {
  return {
    threadId: 'thread-1',
    runId: 'run-2',
    state: { tripPlan: { destination: 'Edited in the browser', nights: null, hotels: [], programmes: [] } },
    messages: [{ id: 'u1', role: 'user', content: 'drop the Park Hyatt' }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  } as RunAgentInput
}

const resumeInput = (interruptId: string, status: 'resolved' | 'cancelled' = 'resolved'): RunAgentInput => {
  return baseInput({ resume: [{ interruptId, status, payload: { approved: true } }] } as Partial<RunAgentInput>)
}

const runToEvents = async (agent: InProcessAgent, input: RunAgentInput): Promise<BaseEvent[]> => {
  return firstValueFrom(agent.run(input).pipe(toArray()))
}

// The stale sweep runs at most once per container per interval, and earlier tests in this file
// already swept: a test that expects a sweep moves the clock past the window first.
let sweepClock = Date.now()

const pastTheSweepWindow = (): void => {
  sweepClock += 2 * STALE_SWEEP_INTERVAL_MS
  vi.useFakeTimers({ toFake: ['Date'], now: sweepClock })
}

describe('inProcessAgent interrupts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ends a paused run with an interrupt outcome and keeps its checkpoint thread', async () => {
    const { graph } = makeGraph(() => {
      return paused()
    })

    const { store, checkpoints } = makeCheckpoints()

    const events = await runToEvents(makeAgent(graph, checkpoints), baseInput({ runId: 'run-1' }))
    const last = events.at(-1) as unknown as { type: EventType; outcome?: { type: string; interrupts: unknown[] } }

    expect(
      events.filter((event) => {
        return event.type === EventType.RUN_FINISHED
      }),
    ).toHaveLength(1)
    expect(last.type).toBe(EventType.RUN_FINISHED)
    expect(last.outcome).toEqual({
      type: 'interrupt',
      interrupts: [
        {
          id: `run-1~${LANGGRAPH_ID}`,
          reason: 'confirm_trip_plan_change',
          message: 'Remove Park Hyatt?',
          expiresAt: expect.any(String),
          metadata: CONFIRMATION,
        },
      ],
    })

    const expiresIn = Date.parse((last.outcome?.interrupts[0] as { expiresAt: string }).expiresAt) - Date.now()

    expect(expiresIn).toBeGreaterThan(INTERRUPT_TTL_MS - 60_000)
    expect(store.deleteThread).not.toHaveBeenCalled()
  })

  it('deletes the thread of a run that ends without an interrupt, and sweeps every stale one', async () => {
    const fake = makeGraph(() => {
      return finished
    })

    const { store, checkpoints } = makeCheckpoints()

    pastTheSweepWindow()

    await runWithRequestContext({ customerId: 'cust-42', awsRequestId: 'req-1' }, async () => {
      const events = await runToEvents(makeAgent(fake.graph, checkpoints), baseInput({ runId: 'run-1' }))

      expect(events.at(-1)).toEqual({ type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1' })
    })

    expect(fake.threadIds).toEqual(['cust-42:run-1'])
    expect(store.deleteThread).toHaveBeenCalledWith('cust-42:run-1')
    // Every owner's stale threads, so a traveller who never returns leaves nothing behind.
    expect(store.deleteStaleThreads).toHaveBeenCalledWith('', expect.any(Date))
  })

  it('sweeps stale threads at most once per window in a container, and deletes every finished thread', async () => {
    const fake = makeGraph(() => {
      return finished
    })

    const { store, checkpoints } = makeCheckpoints()
    const agent = makeAgent(fake.graph, checkpoints)

    pastTheSweepWindow()
    await runToEvents(agent, baseInput({ runId: 'run-1' }))
    await runToEvents(agent, baseInput({ runId: 'run-2' }))

    expect(store.deleteThread).toHaveBeenCalledTimes(2)
    expect(store.deleteStaleThreads).toHaveBeenCalledTimes(1)

    pastTheSweepWindow()
    await runToEvents(agent, baseInput({ runId: 'run-3' }))

    expect(store.deleteStaleThreads).toHaveBeenCalledTimes(2)
  })

  it('resumes the interrupted run with a Command on its own thread, from the checkpointed plan', async () => {
    const fake = makeGraph(() => {
      return fake.inputs.length === 0 ? paused() : finished
    })

    const { store, checkpoints } = makeCheckpoints()

    const events = await runToEvents(makeAgent(fake.graph, checkpoints), resumeInput(`run-1~${LANGGRAPH_ID}`))
    const resume = fake.inputs[0]

    expect(resume).toBeInstanceOf(Command)
    expect((resume as Command).resume).toEqual({ [LANGGRAPH_ID]: { approved: true } })
    expect(fake.threadIds).toEqual(['local:run-1'])
    expect(
      events.find((event) => {
        return event.type === EventType.STATE_SNAPSHOT
      }),
    ).toMatchObject({
      snapshot: { tripPlan: CHECKPOINTED_PLAN },
    })
    // The resumed run finished, so the thread it continued is the one deleted.
    expect(store.deleteThread).toHaveBeenCalledWith('local:run-1')
  })

  it('answers a cancelled interrupt with the refusal the config maps it to', async () => {
    const fake = makeGraph(() => {
      return fake.inputs.length === 0 ? paused() : finished
    })

    const { checkpoints } = makeCheckpoints()

    await runToEvents(makeAgent(fake.graph, checkpoints), resumeInput(`run-1~${LANGGRAPH_ID}`, 'cancelled'))

    expect((fake.inputs[0] as Command).resume).toEqual({ [LANGGRAPH_ID]: { approved: false } })
  })

  it.each([
    ['a forged id', 'not-an-interrupt-id'],
    ['an id with a path in it', `../run-1~${LANGGRAPH_ID}`],
    ['an interrupt that is not open', `run-1~${'f'.repeat(32)}`],
  ])('refuses %s with the fixed message and never runs the graph', async (_label, interruptId) => {
    const fake = makeGraph(() => {
      return paused()
    })

    const { store, checkpoints } = makeCheckpoints()

    await expect(runToEvents(makeAgent(fake.graph, checkpoints), resumeInput(interruptId))).rejects.toThrow(
      RESUME_ERROR_MESSAGE,
    )
    expect(fake.inputs).toEqual([])
    expect(store.deleteThread).not.toHaveBeenCalled()
  })

  it("looks for another traveller's run only inside the caller's namespace, and finds nothing", async () => {
    // The paused run belongs to cust-1; cust-2 replays its interrupt id.
    const fake = makeGraph((threadId) => {
      return threadId === 'cust-1:run-1' ? paused() : absent
    })

    const { checkpoints } = makeCheckpoints()

    await runWithRequestContext({ customerId: 'cust-2', awsRequestId: 'req-2' }, async () => {
      await expect(
        runToEvents(makeAgent(fake.graph, checkpoints), resumeInput(`run-1~${LANGGRAPH_ID}`)),
      ).rejects.toThrow(RESUME_ERROR_MESSAGE)
    })

    expect(fake.stateReads).toEqual(['cust-2:run-1'])
    expect(fake.inputs).toEqual([])
  })

  it('refuses an interrupt older than the time to live', async () => {
    const fake = makeGraph(() => {
      return paused(new Date(Date.now() - INTERRUPT_TTL_MS - 1000).toISOString())
    })

    const { checkpoints } = makeCheckpoints()

    await expect(runToEvents(makeAgent(fake.graph, checkpoints), resumeInput(`run-1~${LANGGRAPH_ID}`))).rejects.toThrow(
      RESUME_ERROR_MESSAGE,
    )
  })

  it('refuses any resume when the agent has no checkpointer', async () => {
    const fake = makeGraph(() => {
      return paused()
    })

    await expect(runToEvents(makeAgent(fake.graph), resumeInput(`run-1~${LANGGRAPH_ID}`))).rejects.toThrow(
      RESUME_ERROR_MESSAGE,
    )
  })

  it('keeps the plain AG-UI thread id and reads no state without checkpoints', async () => {
    const fake = makeGraph(() => {
      return paused()
    })

    const events = await runToEvents(makeAgent(fake.graph), baseInput())

    expect(fake.threadIds).toEqual(['thread-1'])
    expect(fake.stateReads).toEqual([])
    expect(events.at(-1)).not.toHaveProperty('outcome')
  })

  it('carries the checkpoint config through clone()', async () => {
    const fake = makeGraph(() => {
      return paused()
    })

    const { checkpoints } = makeCheckpoints()

    const events = await runToEvents(makeAgent(fake.graph, checkpoints).clone(), baseInput({ runId: 'run-1' }))

    expect(events.at(-1)).toHaveProperty('outcome.type', 'interrupt')
  })

  it('does not fail a finished run when clean-up fails', async () => {
    const fake = makeGraph(() => {
      return finished
    })

    const { store, checkpoints } = makeCheckpoints()

    store.deleteThread.mockRejectedValueOnce(new Error('connection reset'))

    const events = await runToEvents(makeAgent(fake.graph, checkpoints), baseInput())

    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED)
  })
})

// AG-UI `Interrupt.responseSchema`: the answer's shape goes out with the question, and the adapter
// checks a `resolved` payload against it before the graph sees it.
describe('inProcessAgent typed interrupt answers', () => {
  const Answer = z.object({ approved: z.boolean() })

  const typedCheckpoints = (): CheckpointConfig => {
    return {
      ...makeCheckpoints().checkpoints,
      responseSchema: (value) => {
        return (value as { kind?: unknown }).kind === CONFIRMATION.kind
          ? {
              jsonSchema: z.toJSONSchema(Answer),
              parse: (payload) => {
                return Answer.safeParse(payload)
              },
            }
          : undefined
      },
    }
  }

  const resumeWith = (resume: unknown): RunAgentInput => {
    return baseInput({ resume } as Partial<RunAgentInput>)
  }

  it('sends the JSON Schema of the answer on the interrupt', async () => {
    const { graph } = makeGraph(() => {
      return paused()
    })

    const events = await runToEvents(makeAgent(graph, typedCheckpoints()), baseInput({ runId: 'run-1' }))

    expect(events.at(-1)).toHaveProperty('outcome.interrupts.0.responseSchema', z.toJSONSchema(Answer))
  })

  it('leaves a free-form interrupt without a responseSchema', async () => {
    const { graph } = makeGraph(() => {
      return { ...paused(), tasks: [{ interrupts: [{ id: LANGGRAPH_ID, value: { kind: 'other' } }] }] }
    })

    const events = await runToEvents(makeAgent(graph, typedCheckpoints()), baseInput({ runId: 'run-1' }))

    expect(events.at(-1)).not.toHaveProperty('outcome.interrupts.0.responseSchema')
  })

  it('hands the graph the parsed answer, not the raw payload', async () => {
    const fake = makeGraph(() => {
      return fake.inputs.length === 0 ? paused() : finished
    })

    await runToEvents(
      makeAgent(fake.graph, typedCheckpoints()),
      resumeWith([
        { interruptId: `run-1~${LANGGRAPH_ID}`, status: 'resolved', payload: { approved: false, note: 'x' } },
      ]),
    )

    expect((fake.inputs[0] as Command).resume).toEqual({ [LANGGRAPH_ID]: { approved: false } })
  })

  it.each([
    ['a payload of the wrong type', { approved: 'yes' }],
    ['a missing payload', undefined],
  ])('refuses %s with the fixed message and never runs the graph', async (_label, payload) => {
    const fake = makeGraph(() => {
      return paused()
    })

    await expect(
      runToEvents(
        makeAgent(fake.graph, typedCheckpoints()),
        resumeWith([{ interruptId: `run-1~${LANGGRAPH_ID}`, status: 'resolved', payload }]),
      ),
    ).rejects.toThrow(RESUME_ERROR_MESSAGE)
    expect(fake.inputs).toEqual([])
  })

  it('lets a cancel through without a payload to check', async () => {
    const fake = makeGraph(() => {
      return fake.inputs.length === 0 ? paused() : finished
    })

    await runToEvents(
      makeAgent(fake.graph, typedCheckpoints()),
      resumeWith([{ interruptId: `run-1~${LANGGRAPH_ID}`, status: 'cancelled' }]),
    )

    expect((fake.inputs[0] as Command).resume).toEqual({ [LANGGRAPH_ID]: { approved: false } })
  })
})
