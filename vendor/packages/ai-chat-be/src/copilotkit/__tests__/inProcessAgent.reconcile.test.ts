// A tab left open across an edit made elsewhere (the profile page) sends its stale state with the next
// run. The runner hands the kept chat's state to the agent, the agent's `reconcile` picks, and the tab is
// corrected by the run's first STATE_DELTA.
import { EventType } from '@ag-ui/client'
import type { BaseEvent, Message, RunAgentInput } from '@ag-ui/client'
import { lastValueFrom, toArray } from 'rxjs'
import { beforeEach, describe, expect, it } from 'vitest'

import { TEST_APP } from '../../__tests__/helpers/handler-options.js'
import { MemoryStorage } from '../../__tests__/helpers/memory-storage.js'
import { CustomerChatsRunner } from '../customerChatsRunner.js'
import { InProcessAgent } from '../inProcessAgent.js'
import type { SharedStateConfig, StreamableGraph } from '../inProcessAgent.js'
import { runWithRequestContext } from '../requestContext.js'

const OWNER = 'cust-owner'
const AGENT_ID = 'travelAiAgent'
const THREAD = 'thread-1'

interface Plan {
  city: string | null
  editedAt?: string
}

const planOf = (state: unknown): Plan => {
  const plan = (state as { plan?: Partial<Plan> } | null | undefined)?.plan

  return {
    city: typeof plan?.city === 'string' ? plan.city : null,
    ...(typeof plan?.editedAt === 'string' ? { editedAt: plan.editedAt } : {}),
  }
}

// A stand-in for the travel agent's rule: the kept plan wins only when edited strictly later.
const SHARED: SharedStateConfig = {
  keys: ['plan'],
  fromInput: (state) => {
    return { plan: planOf(state) }
  },
  reconcile: (kept, input) => {
    const keptPlan = planOf(kept)
    const inputAt = planOf(input).editedAt

    if (keptPlan.editedAt === undefined) return input

    return inputAt === undefined || keptPlan.editedAt > inputAt ? { ...input, plan: keptPlan } : input
  },
}

const userMessage = (content: string, id: string): Message => {
  return { id, role: 'user', content }
}

describe('reconcile: the kept chat state against a stale tab', () => {
  let storage: MemoryStorage
  let runner: CustomerChatsRunner
  let graphInputs: unknown[] = []

  const graph: StreamableGraph = {
    streamEvents: (graphInput) => {
      graphInputs.push(graphInput)

      return (async function* () {
        yield { event: 'on_chat_model_end', data: {} } as never
      })()
    },
  }

  const runWith = (state: Record<string, unknown>): Promise<BaseEvent[]> => {
    const messages = [userMessage('Hotels in Porto?', 'u1')]
    const agent = new InProcessAgent({ graph, graphId: AGENT_ID, recursionLimit: 8, sharedState: SHARED })

    agent.threadId = THREAD
    agent.messages = messages
    agent.state = state

    const input = { threadId: THREAD, runId: 'run-1', messages, state, tools: [], context: [], forwardedProps: {} }

    return runWithRequestContext({ customerId: OWNER, awsRequestId: 'reconcile-test' }, async () => {
      return lastValueFrom(
        runner.run({ threadId: THREAD, agent, input: input as unknown as RunAgentInput }).pipe(toArray()),
      )
    })
  }

  const keepChat = async (state: Record<string, unknown>) => {
    await storage.history.saveChat({
      id: THREAD,
      customerId: OWNER,
      title: 'Porto',
      messages: [],
      state,
      interrupts: null,
      traceRunIds: {},
    })
  }

  const stateEventsOf = (events: BaseEvent[]) => {
    return events.filter((event) => {
      return (
        event.type === EventType.RUN_STARTED ||
        event.type === EventType.STATE_SNAPSHOT ||
        event.type === EventType.STATE_DELTA
      )
    }) as unknown as Array<{ type: EventType; snapshot?: unknown; delta?: unknown }>
  }

  beforeEach(() => {
    graphInputs = []
    storage = new MemoryStorage()
    storage.customers.add(OWNER)
    runner = new CustomerChatsRunner({ storage, app: TEST_APP, agentIds: [AGENT_ID, 'default'] })
  })

  it('runs on the kept plan edited later and corrects the tab with a delta after RUN_STARTED', async () => {
    const edited = { city: 'Porto', editedAt: '2026-11-09T10:00:00.000Z' }

    await keepChat({ plan: edited })

    const events = await runWith({ plan: { city: 'Lisbon' } })

    expect(graphInputs[0]).toMatchObject({ plan: edited })
    expect(stateEventsOf(events)).toEqual([
      expect.objectContaining({ type: EventType.RUN_STARTED }),
      { type: EventType.STATE_SNAPSHOT, snapshot: { plan: { city: 'Lisbon' } } },
      { type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: '/plan', value: edited }] },
    ])
  })

  it('takes the browser plan on an equal stamp, with no delta for it', async () => {
    const at = '2026-11-09T10:00:00.000Z'

    await keepChat({ plan: { city: 'Porto', editedAt: at } })

    const events = await runWith({ plan: { city: 'Braga', editedAt: at } })

    expect(graphInputs[0]).toMatchObject({ plan: { city: 'Braga', editedAt: at } })
    expect(
      stateEventsOf(events).filter((event) => {
        return event.type === EventType.STATE_DELTA
      }),
    ).toEqual([])
  })

  it('passes a browser plan edited later straight through', async () => {
    await keepChat({ plan: { city: 'Porto', editedAt: '2026-11-09T10:00:00.000Z' } })

    const newer = { city: 'Braga', editedAt: '2026-11-09T11:00:00.000Z' }
    const events = await runWith({ plan: newer })

    expect(graphInputs[0]).toMatchObject({ plan: newer })
    expect(
      stateEventsOf(events).filter((event) => {
        return event.type === EventType.STATE_DELTA
      }),
    ).toEqual([])
  })
})
