import { UseAgentUpdate, useAgent, useCapabilities } from '@copilotkit/react-core/v2'
import { useRef } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { SeedTranscript } from '../__stories__/kit/seed-transcript.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { TripPlanPanel } from '../__stories__/kit/trip-plan.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { agentProgressRenderers } from '../services/main.js'
import {
  AGENT_CAPABILITIES,
  FAKE_THREAD_ID,
  NOMADREAM_PRESET,
  PROGRESS_REPLY,
  PROGRESS_TOOLS,
  REPLY,
  TRIP_PLAN_EDIT_REPLY,
  TRIP_PLAN_HOTELS,
  TRIP_PLAN_REPLY,
  installRuntimeScenario,
  progressFrameBatches,
  scenarios,
  stateEchoReplyFrames,
  tripPlanFrameBatches,
} from './helpers/index.js'
import type { FakeRuntime, TripPlan } from './helpers/index.js'

interface AssistantTimestampProps {
  message: { id: string; role: string }
  position: 'before' | 'after'
  messageIndex: number
}

const AssistantTimestamp = (props: AssistantTimestampProps) => {
  const { message, position, messageIndex } = props

  if (position !== 'after' || message.role !== 'assistant') return null

  return (
    <p data-testid="assistant-timestamp" data-message-index={messageIndex}>
      replied at 09:41
    </p>
  )
}

// The Context and state area: what its stories describe, asserted.

type Screen = Awaited<ReturnType<typeof render>>

const USER_MESSAGE = 'copilot-user-message'
const ASSISTANT_MESSAGE = 'copilot-assistant-message'
const CURSOR = 'copilot-loading-cursor'
const TRAVELLER_NAME = { description: 'Name of the signed-in traveller', value: 'Ada' }
const TRIP = { destination: 'Bangkok', nights: 21 }
const TIER_ENTRY = { description: 'Loyalty tier', value: 'Marriott Bonvoy Platinum' }
const PROPERTIES = { travellerTier: 'platinum', locale: 'en-GB' }

// `forwardedProps` is where AG-UI carries provider `properties`; the fake's RunBody type does not
// declare it because nothing on the Lambda reads it yet.
interface ForwardedPropsBody {
  forwardedProps?: Record<string, unknown>
}

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

// Gated on `isReady`: before `/info` resolves the hook reads a provisional agent, whose
// `capabilities` is undefined for the wrong reason.
const CapabilitiesReport = () => {
  const { isReady } = useAgent({ updates: [] })
  const capabilities = useCapabilities()

  return (
    <p data-testid="capabilities" data-ready={isReady}>
      {isReady ? String(JSON.stringify(capabilities)) : 'connecting…'}
    </p>
  )
}

// Sticky: whether the panel ever rendered a hotel still `pending`, however briefly.
const PendingWitness = () => {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnStateChanged] })
  const plan = (agent.state as { tripPlan?: TripPlan }).tripPlan
  const sawPendingRef = useRef(false)

  if (
    plan?.hotels.some((hotel) => {
      return hotel.pending
    })
  ) {
    sawPendingRef.current = true
  }

  return <p data-testid="pending-witness" data-saw-pending={sawPendingRef.current} />
}

const tripPlanTurn = (outcome: 'saved' | 'failed') => {
  return {
    kind: 'paced',
    batches: tripPlanFrameBatches({
      destination: 'Bangkok',
      nights: 21,
      hotels: TRIP_PLAN_HOTELS,
      replyText: TRIP_PLAN_REPLY,
      outcome,
    }),
    gapMs: 300,
  } as const
}

describe('context and state', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('readables', () => {
    it('sends every entry in order, an object value as JSON text', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          context={[TRAVELLER_NAME, { description: 'Trip under discussion', value: TRIP }, TIER_ENTRY]}
        />,
      )

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
      // The A2UI catalog entry react-core adds while `/info` reports A2UI is not one of these readables.
      const readables = runtime.runs[0]?.body.context?.filter((entry) => {
        return !entry.description.startsWith('A2UI ')
      })

      expect(readables).toEqual([
        TRAVELLER_NAME,
        { description: 'Trip under discussion', value: JSON.stringify(TRIP) },
        TIER_ENTRY,
      ])
    })
  })

  describe('forwarded properties', () => {
    // react-core 1.88 stamps every run with its own `__copilotkitRequestId`; the rest is the caller's.
    const callerProps = (body: unknown): Record<string, unknown> => {
      const { __copilotkitRequestId: requestId, ...rest } = (body as ForwardedPropsBody).forwardedProps as Record<
        string,
        unknown
      >

      expect(requestId).toEqual(expect.any(String))

      return rest
    }

    it('puts provider.properties on the run as forwardedProps, exactly', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} provider={{ properties: PROPERTIES }} />)

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(callerProps(runtime.runs[0]?.body)).toEqual(PROPERTIES)
    })

    it('sends no forwardedProps of its own without the prop', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(callerProps(runtime.runs[0]?.body)).toEqual({})
    })
  })

  describe('custom messages', () => {
    it('renders the element once, after the assistant bubble and not the user one', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ renderCustomMessages: [{ render: AssistantTimestamp }] }} />,
      )

      await send(screen, 'hello')

      await expect.element(screen.getByTestId('assistant-timestamp')).toBeVisible()
      expect(screen.getByTestId('assistant-timestamp').elements()).toHaveLength(1)
      await expect.element(screen.getByTestId('assistant-timestamp')).toHaveAttribute('data-message-index', '1')

      const user = screen.getByTestId(USER_MESSAGE).element()
      const assistant = screen.getByTestId(ASSISTANT_MESSAGE).element()
      const timestamp = screen.getByTestId('assistant-timestamp').element()

      expect(user.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(assistant.compareDocumentPosition(timestamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(runtime.runs).toHaveLength(1)
    })
  })

  describe('capabilities', () => {
    it('reads what /info advertises for the agent once it has landed', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <CapabilitiesReport />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('capabilities')).toHaveAttribute('data-ready', 'true')
      expect(
        runtime.requests.some((request) => {
          return request.method === 'GET' && request.path === '/info'
        }),
      ).toBe(true)
      await expect.element(screen.getByTestId('capabilities')).toHaveTextContent(JSON.stringify(AGENT_CAPABILITIES))
    })
  })

  describe('activity messages', () => {
    const PROGRESS = 'chat-agent-progress'

    it('shows each progress phase of a run under way and nothing once it ends', async () => {
      runtime = installRuntimeScenario({
        run: {
          kind: 'paced',
          batches: progressFrameBatches({ tools: PROGRESS_TOOLS, replyText: PROGRESS_REPLY }),
          gapMs: 300,
        },
      })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ renderActivityMessages: agentProgressRenderers() }}>
          <StartRun message="hello" />
        </AIChat>,
      )

      const progress = screen.getByTestId(PROGRESS)

      await expect.element(progress).toHaveAttribute('data-phase', 'thinking')
      await expect.element(progress).toHaveTextContent('Thinking…Step 1 of up to 8')
      await expect.element(progress).toHaveAttribute('data-phase', 'researching')
      await expect.element(progress).toHaveTextContent('Looking up: hotels search, hotel detail…Step 2 of up to 8')
      await expect.element(progress).toHaveAttribute('data-step', '3')
      await expect.element(progress).toHaveAttribute('data-phase', 'answering')
      await expect.element(screen.getByText(PROGRESS_REPLY)).toBeVisible()
      await expect.element(progress).not.toBeInTheDocument()
      expect(runtime.runs).toHaveLength(1)
    })

    it('shows no progress for a restored conversation, whatever phase it was saved in', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const activity = (id: string, phase: string) => {
        return {
          id,
          role: 'activity' as const,
          activityType: 'agent-progress',
          content: { phase, step: 2, maxSteps: 8, tools: PROGRESS_TOOLS },
        }
      }

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ renderActivityMessages: agentProgressRenderers() }}>
          <SeedTranscript
            messages={[
              { id: 'seed-user-1', role: 'user', content: 'hello' },
              activity('progress-run-a', 'done'),
              { id: 'seed-assistant-1', role: 'assistant', content: REPLY },
              { id: 'seed-user-2', role: 'user', content: 'and Hilton?' },
              // A run cut off before its `done` patch: the saved phase is stale, the run long over.
              activity('progress-run-b', 'researching'),
              { id: 'seed-assistant-2', role: 'assistant', content: PROGRESS_REPLY },
            ]}
          />
        </AIChat>,
      )

      await expect.element(screen.getByText(PROGRESS_REPLY)).toBeVisible()
      await expect.element(screen.getByTestId(PROGRESS)).not.toBeInTheDocument()
    })

    it('never revives a stopped turn’s card while a later run is under way', async () => {
      runtime = installRuntimeScenario({
        run: { kind: 'streamed', words: ['Hilton', 'has', 'four', 'tiers.'], gapMs: 400 },
      })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ renderActivityMessages: agentProgressRenderers() }}>
          <SeedTranscript
            messages={[
              { id: 'seed-user-1', role: 'user', content: 'hello' },
              // Stopped before its `done` patch, so the saved phase still says the run is working.
              {
                id: 'progress-stopped-run',
                role: 'activity',
                activityType: 'agent-progress',
                content: { phase: 'researching', step: 2, maxSteps: 8, tools: PROGRESS_TOOLS },
              },
            ]}
          />
          <StartRun message="and the top tier?" />
        </AIChat>,
      )

      // The run is under way (its first word is in, the rest still streaming): the moment a stale
      // card would show.
      await expect.element(screen.getByText('Hilton', { exact: false })).toBeVisible()
      await expect.element(screen.getByTestId(PROGRESS)).not.toBeInTheDocument()
      expect(runtime.runs).toHaveLength(1)
    })
  })

  describe('shared state', () => {
    const SAVED_PLAN: TripPlan = {
      destination: 'Bangkok',
      nights: 21,
      hotels: TRIP_PLAN_HOTELS,
      programmes: [],
    }

    const [PARK_HYATT, JW_MARRIOTT] = TRIP_PLAN_HOTELS

    const hotels = (screen: Screen) => {
      return screen.getByTestId('trip-plan-hotel')
    }

    it('reads a plan carried by the STATE_SNAPSHOT alone', async () => {
      runtime = installRuntimeScenario({
        run: { kind: 'frames', frames: stateEchoReplyFrames(FAKE_THREAD_ID, { tripPlan: SAVED_PLAN }, REPLY) },
      })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <TripPlanPanel />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('trip-plan-destination')).toHaveTextContent('No destination yet')

      await send(screen, 'what is on my plan?')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('trip-plan-destination')).toHaveTextContent('Bangkok')
      expect(hotels(screen).elements()).toHaveLength(2)
    })

    it('reads the plan the snapshot and the deltas of an update_trip_plan turn end on', async () => {
      runtime = installRuntimeScenario(scenarios.tripPlanAtOnce)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <TripPlanPanel />
        </AIChat>,
      )

      await expect.element(screen.getByText('No hotels yet', { exact: false })).toBeVisible()

      await send(screen, 'plan my stay')

      await expect.element(screen.getByText(TRIP_PLAN_REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('trip-plan-destination')).toHaveTextContent('Bangkok')
      await expect.element(screen.getByTestId('trip-plan-nights')).toHaveTextContent('21 nights')
      await expect.element(hotels(screen).nth(0)).toHaveTextContent(`${PARK_HYATT?.name} hyatt · ploenchit · 5★`)
      await expect.element(hotels(screen).nth(1)).toHaveTextContent(`${JW_MARRIOTT?.name} marriott · sukhumvit · 5★`)
      await expect.element(hotels(screen).nth(0)).toHaveAttribute('data-pending', 'false')
      await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
      expect(runtime.runs).toHaveLength(1)
    })

    it('sends what the traveller set with setState as the next run’s state', async () => {
      runtime = installRuntimeScenario(scenarios.tripPlanThenEdit)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <TripPlanPanel editable />
        </AIChat>,
      )

      await send(screen, 'plan my stay')
      await expect.element(screen.getByText(TRIP_PLAN_REPLY)).toBeVisible()
      await expect.element(hotels(screen).nth(1)).toHaveAttribute('data-pending', 'false')

      await screen.getByRole('button', { name: `Remove ${PARK_HYATT?.name}` }).click()
      await screen.getByRole('button', { name: 'One night fewer' }).click()

      await expect.element(screen.getByTestId('trip-plan-nights')).toHaveTextContent('20 nights')
      expect(hotels(screen).elements()).toHaveLength(1)

      await send(screen, 'does that still work?')

      await expect.element(screen.getByText(TRIP_PLAN_EDIT_REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(2)
      expect(runtime.runs[0]?.body.state?.tripPlan).toBeUndefined()
      expect(runtime.runs[1]?.body.state?.tripPlan).toEqual({ ...SAVED_PLAN, nights: 20, hotels: [JW_MARRIOTT] })
      // The run's echo of that state keeps the edit on screen.
      await expect.element(screen.getByTestId('trip-plan-nights')).toHaveTextContent('20 nights')
      expect(hotels(screen).elements()).toHaveLength(1)
    })

    it('shows a hotel pending while the call streams, then the catalogue-confirmed one', async () => {
      runtime = installRuntimeScenario({ run: tripPlanTurn('saved') })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <TripPlanPanel />
          <PendingWitness />
        </AIChat>,
      )

      await send(screen, 'plan my stay')

      await expect.element(screen.getByTestId('trip-plan-destination')).toHaveTextContent('Bangkok')
      await expect.element(hotels(screen).nth(0)).toHaveAttribute('data-pending', 'true')
      await expect.element(hotels(screen).nth(0)).toHaveTextContent(`${PARK_HYATT?.name} checking the catalogue…`)
      // Still mid-run: the reply is the last batch.
      expect(screen.getByText(TRIP_PLAN_REPLY).elements()).toHaveLength(0)

      await expect.element(hotels(screen).nth(1)).toHaveAttribute('data-pending', 'false')
      await expect.element(hotels(screen).nth(0)).toHaveTextContent(`${PARK_HYATT?.name} hyatt · ploenchit · 5★`)
      await expect.element(screen.getByText(TRIP_PLAN_REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('pending-witness')).toHaveAttribute('data-saw-pending', 'true')
    })

    // The control for the test above: the same frames in one flush never paint a pending hotel, so
    // the pending assertion there depends on the deltas arriving apart.
    it('never paints a pending hotel when the same frames arrive in one flush', async () => {
      runtime = installRuntimeScenario(scenarios.tripPlanAtOnce)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <PendingWitness />
        </AIChat>,
      )

      await send(screen, 'plan my stay')

      await expect.element(screen.getByText(TRIP_PLAN_REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('pending-witness')).toHaveAttribute('data-saw-pending', 'false')
    })

    it('reverts the projected plan when the run fails', async () => {
      runtime = installRuntimeScenario({ run: tripPlanTurn('failed') })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <TripPlanPanel />
        </AIChat>,
      )

      await send(screen, 'plan my stay')

      await expect.element(hotels(screen).nth(1)).toHaveAttribute('data-pending', 'true')
      await expect.element(screen.getByTestId('trip-plan-destination')).toHaveTextContent('Bangkok')

      await expect.element(screen.getByTestId('trip-plan-destination')).toHaveTextContent('No destination yet')
      await expect.element(screen.getByText('No hotels yet', { exact: false })).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
    })
  })
})
