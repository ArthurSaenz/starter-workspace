import { useComponent } from '@copilotkit/react-core/v2'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { FeatureCardComponent } from '../../catalogue/index.js'
import { featureById } from '../__stories__/kit/define-feature-meta.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { showHotelCardTool } from '../__stories__/kit/tools.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { toolCallRenderers } from '../services/main.js'
import type { AiChatProps } from '../types.js'
import { ShowHotelCard } from './helpers/demo-tools.js'
import {
  BACKEND_TOOL_CALL,
  NOMADREAM_PRESET,
  TOOL_CALL,
  installRuntimeScenario,
  scenarios,
  toolCallFrames,
} from './helpers/index.js'
import type { FakeRuntime, RuntimeScenario } from './helpers/index.js'

interface HotelSummaryProps {
  hotel?: string
  nights?: number
}

const HotelSummary = (props: HotelSummaryProps) => {
  const { hotel, nights } = props

  return (
    <div data-testid="hotel-summary">
      {hotel} for {nights} nights
    </div>
  )
}

const HotelSummaryTool = () => {
  useComponent({ name: 'hotelSummary', description: 'A one-line summary', render: HotelSummary })

  return null
}

interface LoyaltyBalanceProps {
  args: { programme?: string }
  status: string
  result: string | undefined
}

const LoyaltyBalance = (props: LoyaltyBalanceProps) => {
  const { args, status, result } = props

  return (
    <div data-testid="loyalty-balance" data-status={status}>
      {args.programme} · {status} · {result}
    </div>
  )
}

interface WildcardCardProps {
  name: string
  args: Record<string, unknown>
  status: string
  result: string | undefined
}

const WildcardCard = (props: WildcardCardProps) => {
  const { name, args, status, result } = props

  return (
    <div data-testid="wildcard-card" data-tool-name={name} data-status={status}>
      {name}({JSON.stringify(args)}) → {result ?? status}
    </div>
  )
}

// The Tools and generative UI area: what its stories show, asserted. The stories open on a state;
// these check the wire and the transitions between states.

type Screen = Awaited<ReturnType<typeof render>>

const ASSISTANT_MESSAGE = 'copilot-assistant-message'
const CURSOR = 'copilot-loading-cursor'

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

const withProvider = (provider: AiChatProps['provider']): AiChatProps => {
  return { ...NOMADREAM_PRESET, provider: { ...NOMADREAM_PRESET.provider, ...provider } }
}

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

const insideAssistantTurn = (screen: Screen, testId: string) => {
  return screen
    .getByTestId(ASSISTANT_MESSAGE)
    .elements()
    .some((message) => {
      return message.querySelector(`[data-testid="${testId}"]`) !== null
    })
}

const toolNamesOf = (runtime: FakeRuntime, run: number) => {
  return runtime.runs[run]?.body.tools?.map((tool) => {
    return tool.name
  })
}

const noop = async () => {
  return undefined
}

// The browser handler answers the call (no result in the frames), which is what decides whether
// core runs again.
const handlerAnswers = (secondReply: string): RuntimeScenario => {
  return {
    run: [
      { kind: 'frames', frames: toolCallFrames({ name: TOOL_CALL.name, args: TOOL_CALL.args }) },
      { kind: 'reply', text: secondReply },
    ],
  }
}

const TOOL_RESULT_MESSAGE = { role: 'tool', toolCallId: 'call-1', content: JSON.stringify(TOOL_CALL.result) }

describe('tools and generative UI', () => {
  let runtime: FakeRuntime | undefined

  afterEach(() => {
    runtime?.restore()
    runtime = undefined
    vi.restoreAllMocks()
  })

  describe('frontend tool', () => {
    // The hook path (card inside the assistant turn, the tool on the wire) is ai-chat-tools.test.tsx.
    it('opens on the card when the story starts the run', async () => {
      runtime = installRuntimeScenario(scenarios.toolCall)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ShowHotelCard />
          <StartRun message="show me the Mandarin" />
        </AIChat>,
      )

      await expect
        .element(screen.getByTestId('hotel-card'))
        .toHaveTextContent('Mandarin Oriental Bangkok · 21 nights · complete')
      expect(insideAssistantTurn(screen, 'hotel-card')).toBe(true)
    })

    it('puts a provider.frontendTools entry on the wire with its description', async () => {
      runtime = installRuntimeScenario(scenarios.default)
      const tool = { name: TOOL_CALL.name, description: 'Show a hotel card for a stay', handler: noop }

      const screen = await mount(<AIChat {...withProvider({ frontendTools: [tool] })} />)

      await send(screen, 'hello')

      await expect.element(screen.getByTestId(ASSISTANT_MESSAGE)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.body.tools).toEqual([
        expect.objectContaining({ name: tool.name, description: tool.description }),
      ])
    })
  })

  it('tool availability: an `available: false` tool stays off the wire', async () => {
    runtime = installRuntimeScenario(scenarios.default)

    const screen = await mount(
      <AIChat
        {...withProvider({
          frontendTools: [
            { name: TOOL_CALL.name, description: 'Show a hotel card', handler: noop, available: false },
            { name: 'sendItinerary', description: 'Email the itinerary', handler: noop },
          ],
        })}
      >
        <StartRun message="hello" />
      </AIChat>,
    )

    await expect.element(screen.getByTestId(ASSISTANT_MESSAGE)).toBeVisible()
    expect(runtime.runs).toHaveLength(1)
    expect(toolNamesOf(runtime, 0)).toEqual(['sendItinerary'])
  })

  it('component as tool: renders from the args, answers with an empty result and runs again', async () => {
    const followUp = 'That is the hotel — shall I price the stay?'

    runtime = installRuntimeScenario({
      run: [
        {
          kind: 'frames',
          frames: toolCallFrames({ name: 'hotelSummary', args: { hotel: 'Mandarin Oriental Bangkok', nights: 21 } }),
        },
        { kind: 'reply', text: followUp },
      ],
    })

    const screen = await mount(
      <AIChat {...NOMADREAM_PRESET}>
        <HotelSummaryTool />
        <StartRun message="summarise the Mandarin" />
      </AIChat>,
    )

    await expect
      .element(screen.getByTestId('hotel-summary'))
      .toHaveTextContent('Mandarin Oriental Bangkok for 21 nights')
    expect(insideAssistantTurn(screen, 'hotel-summary')).toBe(true)
    expect(runtime.runs[0]?.body.tools).toEqual([
      expect.objectContaining({
        name: 'hotelSummary',
        description: expect.stringContaining('Use this tool to display the "hotelSummary" component'),
      }),
    ])

    await expect.element(screen.getByText(followUp)).toBeVisible()
    expect(runtime.runs).toHaveLength(2)
    expect(runtime.runs[1]?.body.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'call-1', content: '' }),
    )
  })

  describe('follow-up run', () => {
    it('runs again with the handler result by default', async () => {
      const followUp = 'The card is up — want me to price those 21 nights?'

      runtime = installRuntimeScenario(handlerAnswers(followUp))

      const screen = await mount(
        <AIChat {...withProvider({ frontendTools: [showHotelCardTool] })}>
          <StartRun message="show me the Mandarin" />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('hotel-card')).toHaveAttribute('data-status', 'complete')
      await expect.element(screen.getByText(followUp)).toBeVisible()
      expect(runtime.runs).toHaveLength(2)
      expect(runtime.runs[1]?.body.messages).toContainEqual(expect.objectContaining(TOOL_RESULT_MESSAGE))
    })

    it('with `followUp: false` stays on one run and sends the result with the next message', async () => {
      const nextReply = 'Sure — here is the total.'

      runtime = installRuntimeScenario(handlerAnswers(nextReply))

      const screen = await mount(
        <AIChat {...withProvider({ frontendTools: [{ ...showHotelCardTool, followUp: false }] })}>
          <StartRun message="show me the Mandarin" />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('hotel-card')).toHaveAttribute('data-status', 'complete')
      // The default path's follow-up lands within the same tick as the handler result; a generous
      // window makes "still one run" mean something.
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })
      expect(runtime.runs).toHaveLength(1)

      await send(screen, 'and the price?')

      await expect.element(screen.getByText(nextReply)).toBeVisible()
      expect(runtime.runs).toHaveLength(2)
      const messages = runtime.runs[1]?.body.messages ?? []

      expect(messages).toContainEqual(expect.objectContaining(TOOL_RESULT_MESSAGE))
      expect(messages).toContainEqual(expect.objectContaining({ role: 'user', content: 'and the price?' }))
    })
  })

  it('default tool-call chrome: a call with no renderer renders nothing and warns in development', async () => {
    runtime = installRuntimeScenario(scenarios.backendToolCall)
    const warn = vi.spyOn(console, 'warn')

    const screen = await mount(
      <AIChat {...NOMADREAM_PRESET}>
        <StartRun message="points?" />
      </AIChat>,
    )

    await expect.element(screen.getByTestId(ASSISTANT_MESSAGE)).toBeInTheDocument()
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    expect(runtime.runs).toHaveLength(1)
    expect(screen.getByTestId('copilot-tool-render').query()).toBeNull()
    expect(screen.getByTestId(ASSISTANT_MESSAGE).element().textContent).not.toContain(BACKEND_TOOL_CALL.name)
    expect(screen.getByTestId(ASSISTANT_MESSAGE).element().textContent).not.toContain(BACKEND_TOOL_CALL.args.programme)
    await vi.waitFor(() => {
      expect(warn.mock.calls.flat().join('\n')).toContain(
        `[CopilotKit] The agent called the tool "${BACKEND_TOOL_CALL.name}", and no renderer is registered for it, so that message rendered nothing.`,
      )
    })
  })

  it('render a named tool: the card renders in the reply and nothing goes on the wire', async () => {
    runtime = installRuntimeScenario(scenarios.backendToolCall)

    const screen = await mount(
      <AIChat {...withProvider({ renderToolCalls: [{ name: BACKEND_TOOL_CALL.name, render: LoyaltyBalance }] })}>
        <StartRun message="how many points do I have?" />
      </AIChat>,
    )

    await expect.element(screen.getByTestId('loyalty-balance')).toHaveAttribute('data-status', 'complete')
    expect(screen.getByTestId('loyalty-balance').element().textContent).toBe(
      `${BACKEND_TOOL_CALL.args.programme} · complete · ${JSON.stringify(BACKEND_TOOL_CALL.result)}`,
    )
    expect(insideAssistantTurn(screen, 'loyalty-balance')).toBe(true)
    expect(screen.getByTestId('copilot-tool-render').query()).toBeNull()
    expect(runtime.runs).toHaveLength(1)
    expect(runtime.runs[0]?.body.tools ?? []).toEqual([])
  })

  it('catch-all renderer: `*` renders an unnamed tool call and is never a tool on the wire', async () => {
    runtime = installRuntimeScenario(scenarios.backendToolCall)

    const screen = await mount(
      <AIChat {...withProvider({ renderToolCalls: [{ name: '*', render: WildcardCard }] })}>
        <StartRun message="points?" />
      </AIChat>,
    )

    await expect.element(screen.getByTestId('wildcard-card')).toHaveAttribute('data-status', 'complete')
    await expect.element(screen.getByTestId('wildcard-card')).toHaveAttribute('data-tool-name', BACKEND_TOOL_CALL.name)
    expect(screen.getByTestId('wildcard-card').element().textContent).toBe(
      `${BACKEND_TOOL_CALL.name}(${JSON.stringify(BACKEND_TOOL_CALL.args)}) → ${JSON.stringify(BACKEND_TOOL_CALL.result)}`,
    )
    expect(insideAssistantTurn(screen, 'wildcard-card')).toBe(true)
    expect(runtime.runs).toHaveLength(1)
    expect(runtime.runs[0]?.body.tools ?? []).toEqual([])
  })

  describe('universal tool-call line', () => {
    // Labels per status and the DOM contract in isolation are tool-call-line.test.tsx; these are the
    // line inside a real chat.
    it('shows "Checked …" once the call has a result', async () => {
      runtime = installRuntimeScenario(scenarios.backendToolCall)

      const screen = await mount(
        <AIChat {...withProvider({ renderToolCalls: toolCallRenderers() })}>
          <StartRun message="points?" />
        </AIChat>,
      )

      const line = screen.getByTestId('chat-tool-call')

      await expect.element(line).toHaveAttribute('data-tool-status', 'complete')
      await expect.element(line).toHaveAttribute('data-tool-name', BACKEND_TOOL_CALL.name)
      await expect.element(line).toHaveAttribute('role', 'status')
      await expect.element(line).toHaveAttribute('aria-live', 'polite')
      await expect.element(line).toHaveTextContent('Checked lookup loyalty balance')
      expect(line.element().textContent).not.toContain(BACKEND_TOOL_CALL.args.programme)
      expect(insideAssistantTurn(screen, 'chat-tool-call')).toBe(true)
      expect(runtime.runs[0]?.body.tools ?? []).toEqual([])
    })

    it('shows "Looking up …" while the call has no result', async () => {
      runtime = installRuntimeScenario({
        run: {
          kind: 'frames',
          frames: toolCallFrames({ name: BACKEND_TOOL_CALL.name, args: BACKEND_TOOL_CALL.args }),
        },
      })

      const screen = await mount(
        <AIChat {...withProvider({ renderToolCalls: toolCallRenderers() })}>
          <StartRun message="points?" />
        </AIChat>,
      )

      const line = screen.getByTestId('chat-tool-call')

      await expect.element(line).toHaveTextContent('Looking up lookup loyalty balance…')
      expect(line.element().getAttribute('data-tool-status')).not.toBe('complete')
    })
  })

  it('webMCP exposure: this Chromium has no document.modelContext, so the registration is a no-op', () => {
    // When this flips, the feature can get a live story instead of its card.
    expect('modelContext' in document).toBe(false)
  })

  describe('features we cannot use show only their card', () => {
    it.each([
      ['genui.mcpApps', 'backend-blocked'],
      ['genui.jsonRender', 'out-of-scope'],
      ['genui.hashbrown', 'out-of-scope'],
      ['tools.webmcp', 'off-by-default'],
    ] as const)('%s is %s', async (id, status) => {
      const screen = await render(<FeatureCardComponent feature={featureById(id)} />)

      await expect.element(screen.getByTestId('catalogue-feature-card')).toHaveAttribute('data-feature-id', id)
      await expect.element(screen.getByTestId('catalogue-status')).toHaveTextContent(status)

      const blockedBy = screen.getByTestId('catalogue-blocked-by')

      if (status === 'backend-blocked') {
        await expect.element(blockedBy).toHaveTextContent('lambda-backend')
      } else {
        expect(blockedBy.query()).toBeNull()
      }
    })
  })
})
