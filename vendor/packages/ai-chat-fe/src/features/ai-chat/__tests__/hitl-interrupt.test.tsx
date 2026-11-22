import { useSuggestions } from '@copilotkit/react-core/v2'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { StartRun } from '../__stories__/kit/start-run.js'
import {
  HeadlessTripPlanConfirmation,
  InChatTripPlanConfirmation,
  TALK_PAST_CONFIRMATION_MESSAGE,
  TalkPastConfirmation,
} from '../__stories__/kit/trip-plan-confirmation.js'
import { TripPlanPanel } from '../__stories__/kit/trip-plan.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { useAwaitingInterrupt } from '../services/main.js'
import {
  DEFAULT_GENERATED_SUGGESTIONS,
  FAKE_THREAD_ID,
  NOMADREAM_PRESET,
  REPLY,
  TRIP_PLAN_HOTELS,
  TRIP_PLAN_KEPT_REPLY,
  TRIP_PLAN_REMOVAL,
  TRIP_PLAN_REMOVED_REPLY,
  TRIP_PLAN_TO_CONFIRM,
  errorFrames,
  installRuntimeScenario,
  scenarios,
  tripPlanInterruptFrames,
} from './helpers/index.js'
import type { FakeRuntime, RuntimeScenario } from './helpers/index.js'

// Agent interrupts (`hitl.interrupt`, `hitl.headless`): the trip-plan confirmation the backend pauses
// on, answered through `useInterrupt`, and what keeps a chat with an open interrupt from getting stuck.

const PARK_HYATT = TRIP_PLAN_HOTELS[0]!
const PLAN_STATE = { tripPlan: TRIP_PLAN_TO_CONFIRM }
const REMOVE_MESSAGE = 'Drop Park Hyatt from my plan.'
// vendor/packages/ai-chat-be/src/copilotkit/inProcessAgent.ts `RESUME_ERROR_MESSAGE`.
const RESUME_ERROR_MESSAGE = 'That confirmation is no longer open. Please ask again.'
const CURSOR = 'copilot-loading-cursor'
const PILL = 'copilot-suggestion'

const SuggestionsProbe = () => {
  const { isLoading } = useSuggestions()

  return <output data-testid="suggestions-loading" data-loading={String(isLoading)} />
}

const AwaitingProbe = () => {
  const awaiting = useAwaitingInterrupt()

  return <output data-testid="awaiting-interrupt" data-awaiting={String(awaiting)} />
}

// The confirmation behind a switch: unmounting and mounting it again is what a re-keyed panel does.
const RemountableConfirmation = () => {
  const [mounted, setMounted] = useState(true)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted((previous) => {
            return !previous
          })
        }}
      >
        Toggle confirmation
      </button>
      {mounted ? <InChatTripPlanConfirmation /> : null}
    </>
  )
}

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

type Screen = Awaited<ReturnType<typeof render>>

const mountInChat = (
  features?: Parameters<typeof AIChat>[0]['features'],
  extra?: ReactElement,
  confirmation: ReactElement = <InChatTripPlanConfirmation />,
) => {
  return mount(
    <AIChat {...NOMADREAM_PRESET} features={features ?? NOMADREAM_PRESET.features}>
      <TripPlanPanel />
      {confirmation}
      <AwaitingProbe />
      <StartRun message={REMOVE_MESSAGE} state={PLAN_STATE} />
      {extra}
    </AIChat>,
  )
}

const hotelNames = (screen: Screen) => {
  return screen
    .getByTestId('trip-plan-hotel')
    .elements()
    .map((element) => {
      return element.textContent
    })
}

const expectAwaiting = async (screen: Screen, awaiting: boolean) => {
  await expect.element(screen.getByTestId('awaiting-interrupt')).toHaveAttribute('data-awaiting', String(awaiting))
}

const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

describe('agent interrupt', () => {
  let runtime: FakeRuntime | undefined

  afterEach(() => {
    runtime?.restore()
    runtime = undefined
  })

  const install = (scenario: RuntimeScenario) => {
    runtime = installRuntimeScenario(scenario)

    return runtime
  }

  it('pauses on the removal: the card names the hotel, the turn ends idle and the plan is untouched', async () => {
    const fake = install(scenarios.tripPlanConfirmation)
    const screen = await mountInChat()

    const prompt = screen.getByTestId('interrupt-prompt')

    await expect.element(prompt).toBeVisible()
    await expect.element(screen.getByTestId('interrupt-changes')).toHaveTextContent(`Remove ${PARK_HYATT.name}`)
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    await expectAwaiting(screen, true)
    expect(fake.runs).toHaveLength(1)
    // `<run that paused>~<LangGraph interrupt id>`, the backend's id format.
    expect(prompt.element().getAttribute('data-interrupt-id')).toMatch(
      new RegExp(`^${fake.runs[0]?.body.runId ?? 'missing'}~[0-9a-f]{32}$`),
    )
    expect(hotelNames(screen)).toHaveLength(2)
  })

  it('allow resumes the paused run with an approval, and the removal lands', async () => {
    const fake = install(scenarios.tripPlanConfirmation)
    const screen = await mountInChat()

    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()

    const interruptId = screen.getByTestId('interrupt-prompt').element().getAttribute('data-interrupt-id')

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect.element(screen.getByText(TRIP_PLAN_REMOVED_REPLY)).toBeVisible()
    expect(fake.runs).toHaveLength(2)
    expect(fake.runs[1]?.body.resume).toEqual([{ interruptId, status: 'resolved', payload: { approved: true } }])
    // react-core 1.75.2+ gives a resume its own run id; the interrupt id names the paused run.
    expect(fake.runs[1]?.body.runId).not.toBe(fake.runs[0]?.body.runId)
    await expect.element(screen.getByTestId('interrupt-prompt')).not.toBeInTheDocument()
    await vi.waitFor(() => {
      expect(hotelNames(screen)).toEqual([expect.stringContaining(TRIP_PLAN_HOTELS[1]!.name)])
    })
    await expectAwaiting(screen, false)
  })

  it('keep my plan resumes with a typed refusal, not a cancel', async () => {
    const fake = install(scenarios.tripPlanConfirmation)
    const screen = await mountInChat()

    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Keep my plan' }))

    await expect.element(screen.getByText(TRIP_PLAN_KEPT_REPLY)).toBeVisible()
    expect(fake.runs).toHaveLength(2)

    const [answer] = fake.runs[1]?.body.resume ?? []

    expect(answer).toMatchObject({ status: 'resolved', payload: { approved: false } })
    expect(hotelNames(screen)).toHaveLength(2)
    await expectAwaiting(screen, false)
  })

  // react-core does not cancel an open interrupt when a new message is sent: `@ag-ui/client` refuses
  // the run in `onInitialize`, before any request, and core turns that into the chat's error line.
  it('a message sent past the confirmation never leaves the browser, and the card stays answerable', async () => {
    const fake = install(scenarios.tripPlanConfirmation)
    const screen = await mountInChat(undefined, <TalkPastConfirmation />)

    await expect.element(screen.getByText(TALK_PAST_CONFIRMATION_MESSAGE)).toBeVisible()
    await expect.element(screen.getByTestId('ai-chat-error')).toBeVisible()
    expect(fake.runs).toHaveLength(1)
    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()
    await expectAwaiting(screen, true)

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect.element(screen.getByText(TRIP_PLAN_REMOVED_REPLY)).toBeVisible()
    expect(fake.runs).toHaveLength(2)
    expect(fake.runs[1]?.body.resume).toEqual([expect.objectContaining({ status: 'resolved' })])
  })

  it('a resume the backend refuses leaves a chat that sends again, not one that refuses every message', async () => {
    const fake = install({
      run: (runIndex, body) => {
        if (runIndex === 0) {
          return {
            kind: 'frames',
            frames: tripPlanInterruptFrames({
              runId: body.runId,
              plan: TRIP_PLAN_TO_CONFIRM,
              change: TRIP_PLAN_REMOVAL,
            }),
          }
        }

        if (body.resume) return { kind: 'frames', frames: errorFrames(FAKE_THREAD_ID, RESUME_ERROR_MESSAGE) }

        return { kind: 'reply', text: REPLY }
      },
    })

    const screen = await mountInChat()

    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect.element(screen.getByTestId('ai-chat-error')).toHaveTextContent(RESUME_ERROR_MESSAGE)
    await expect.element(screen.getByTestId('interrupt-prompt')).not.toBeInTheDocument()
    await expectAwaiting(screen, false)

    await send(screen, 'Then just keep both.')

    await expect.element(screen.getByText(REPLY)).toBeVisible()
    expect(fake.runs).toHaveLength(3)
    expect(fake.runs[2]?.body.resume).toBeUndefined()
  })

  // react-core 1.88: a `useInterrupt` that mounts while the agent still lists an interrupt shows it
  // again (before, only the run that raised it did).
  it('a confirmation mounted again while the question is open shows it once and still answers it', async () => {
    const fake = install(scenarios.tripPlanConfirmation)
    const screen = await mountInChat(undefined, undefined, <RemountableConfirmation />)
    const toggle = screen.getByRole('button', { name: 'Toggle confirmation' })

    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()

    await userEvent.click(toggle)
    await expect.element(screen.getByTestId('interrupt-prompt')).not.toBeInTheDocument()
    await expectAwaiting(screen, true)

    await userEvent.click(toggle)
    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()
    expect(screen.getByTestId('interrupt-prompt').elements()).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect.element(screen.getByText(TRIP_PLAN_REMOVED_REPLY)).toBeVisible()
    expect(fake.runs).toHaveLength(2)
    expect(fake.runs[1]?.body.resume).toEqual([expect.objectContaining({ status: 'resolved' })])
    await expect.element(screen.getByTestId('interrupt-prompt')).not.toBeInTheDocument()
    await expectAwaiting(screen, false)
  })

  it('a confirmation mounted again after a refused resume stays gone', async () => {
    install({
      run: (runIndex, body) => {
        if (runIndex === 0) {
          return {
            kind: 'frames',
            frames: tripPlanInterruptFrames({
              runId: body.runId,
              plan: TRIP_PLAN_TO_CONFIRM,
              change: TRIP_PLAN_REMOVAL,
            }),
          }
        }

        return { kind: 'frames', frames: errorFrames(FAKE_THREAD_ID, RESUME_ERROR_MESSAGE) }
      },
    })

    const screen = await mountInChat(undefined, undefined, <RemountableConfirmation />)
    const toggle = screen.getByRole('button', { name: 'Toggle confirmation' })

    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await expect.element(screen.getByTestId('ai-chat-error')).toHaveTextContent(RESUME_ERROR_MESSAGE)
    await expectAwaiting(screen, false)

    await userEvent.click(toggle)
    await userEvent.click(toggle)

    await expectAwaiting(screen, false)
    expect(screen.getByTestId('interrupt-prompt').elements()).toHaveLength(0)
  })

  it('an expired interrupt neither holds the composer nor refuses the next message', async () => {
    const fake = install({
      run: (runIndex, body) => {
        if (runIndex > 0) return { kind: 'reply', text: REPLY }

        return {
          kind: 'frames',
          frames: tripPlanInterruptFrames({
            runId: body.runId,
            plan: TRIP_PLAN_TO_CONFIRM,
            change: TRIP_PLAN_REMOVAL,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        }
      },
    })

    const screen = await mountInChat()

    await vi.waitFor(() => {
      expect(fake.runs).toHaveLength(1)
    })
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    await expectAwaiting(screen, false)

    await send(screen, 'Hello again')

    await expect.element(screen.getByText(REPLY)).toBeVisible()
    expect(fake.runs).toHaveLength(2)
    expect(screen.getByTestId('ai-chat-error').query()).toBeNull()
  })

  it('withholds the agent-generated pills while the confirmation waits, and brings them back after', async () => {
    const fake = install(scenarios.tripPlanConfirmation)

    const screen = await mountInChat(
      {
        ...NOMADREAM_PRESET.features,
        dynamicSuggestions: { instructions: 'Suggest what a long-stay traveller in Bangkok could ask next.' },
      },
      <SuggestionsProbe />,
    )

    await expect.element(screen.getByTestId('interrupt-prompt')).toBeVisible()
    // The engine still asks for pills when the run ends; they are what gets withheld once it settles.
    await vi.waitFor(() => {
      expect(fake.suggests).toHaveLength(1)
    })
    await expect.element(screen.getByTestId('suggestions-loading')).toHaveAttribute('data-loading', 'false')
    expect(screen.getByTestId(PILL).elements()).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect.element(screen.getByText(TRIP_PLAN_REMOVED_REPLY)).toBeVisible()
    await vi.waitFor(() => {
      expect(screen.getByTestId(PILL).elements()).toHaveLength(DEFAULT_GENERATED_SUGGESTIONS.length)
    })
  })
})

describe('headless interrupt', () => {
  let runtime: FakeRuntime | undefined

  afterEach(() => {
    runtime?.restore()
    runtime = undefined
  })

  const ChatWithSidePanel = () => {
    const [slot, setSlot] = useState<HTMLElement | null>(null)

    return (
      <div style={{ display: 'flex', height: 600 }}>
        <aside ref={setSlot} data-testid="side-panel" style={{ width: 280 }} />
        <AIChat {...NOMADREAM_PRESET} className="flex-1">
          <TripPlanPanel />
          <HeadlessTripPlanConfirmation slot={slot} />
          <StartRun message={REMOVE_MESSAGE} state={PLAN_STATE} />
        </AIChat>
      </div>
    )
  }

  it('draws the card where it is placed, never in the transcript, and answers the same way', async () => {
    runtime = installRuntimeScenario(scenarios.tripPlanConfirmation)

    const screen = await render(<ChatWithSidePanel />)

    const prompt = screen.getByTestId('side-panel').getByTestId('interrupt-prompt')

    await expect.element(prompt).toBeVisible()
    expect(prompt.element().closest('[data-testid="copilot-chat"]')).toBeNull()
    expect(screen.getByTestId('interrupt-prompt').elements()).toHaveLength(1)

    await userEvent.click(prompt.getByRole('button', { name: 'Allow' }))

    await expect.element(screen.getByText(TRIP_PLAN_REMOVED_REPLY)).toBeVisible()
    expect(runtime.runs[1]?.body.resume).toEqual([
      expect.objectContaining({ status: 'resolved', payload: { approved: true } }),
    ])
    await expect.element(prompt).not.toBeInTheDocument()
  })
})
