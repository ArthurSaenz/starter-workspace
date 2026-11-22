import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { AIChatContainer } from '../containers/ai-chat-container.js'
import { useAwaitingToolCall } from '../services/main.js'
import { ConfirmBudget, ShowHotelCard } from './helpers/demo-tools.js'
import {
  HITL_REPLY,
  HITL_TOOL_CALL,
  NOMADREAM_PRESET,
  TOOL_CALL,
  installRuntimeScenario,
  scenarios,
} from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// Rows 23/24 are PATHS, not product features (see ./helpers/demo-tools.tsx for the wrappers).

const CURSOR = 'copilot-loading-cursor'

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (text: string) => {
  await page.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

const promptText = (screen: Awaited<ReturnType<typeof render>>) => {
  return screen.getByTestId('hitl-prompt').element().textContent ?? ''
}

const sendButtonIcon = (screen: Awaited<ReturnType<typeof render>>) => {
  return screen.getByTestId('copilot-send-button').element().querySelector('svg')?.getAttribute('class') ?? ''
}

const AwaitingProbe = () => {
  return <output data-testid="awaiting-probe">{String(useAwaitingToolCall())}</output>
}

const awaitingText = (screen: Awaited<ReturnType<typeof render>>) => {
  return screen.getByTestId('awaiting-probe').element().textContent
}

describe('aIChatContainer tool paths (plan §5 rows 23–24)', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
  })

  it('renders TOOL_CALL frames for a registered frontend tool', async () => {
    runtime = installRuntimeScenario(scenarios.toolCall)

    const screen = await render(
      <AIChatContainer preset={NOMADREAM_PRESET} userName="Ada">
        <ShowHotelCard />
      </AIChatContainer>,
    )

    await send('show me the Mandarin')

    // The card sits inside the assistant turn, fed by the TOOL_CALL_ARGS delta.
    await expect.element(screen.getByTestId('hotel-card')).toBeVisible()
    expect(screen.getByTestId('hotel-card').element().textContent).toContain('Mandarin Oriental Bangkok · 21 nights')
    expect(
      screen.getByTestId('copilot-assistant-message').element().querySelector('[data-testid="hotel-card"]'),
    ).not.toBeNull()

    // The FE puts the registered tool on the wire; the BE forwards input.tools to the graph.
    expect(runtime.runs).toHaveLength(1)
    const toolNames = runtime.runs[0]?.body.tools?.map((tool) => {
      return tool.name
    })

    expect(toolNames).toEqual([TOOL_CALL.name])
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
  })

  it('a human response is sent as a tool message on the next run', async () => {
    runtime = installRuntimeScenario(scenarios.humanInTheLoop)

    const screen = await render(
      <AIChatContainer preset={NOMADREAM_PRESET} userName="Ada">
        <ConfirmBudget />
      </AIChatContainer>,
    )

    await send('budget?')

    await expect.element(screen.getByTestId('hitl-prompt')).toBeVisible()
    expect(promptText(screen)).toContain('Keep it under $4200? (executing)')
    expect(runtime.runs).toHaveLength(1)

    // FINDING-4: the wait between run 1's RUN_FINISHED and respond() does NOT look like thinking —
    // no cursor, the arrow send icon (not the square stop), textarea enabled, nothing posted to /stop.
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    await expect.element(screen.getByRole('textbox')).not.toBeDisabled()
    expect(sendButtonIcon(screen)).toContain('lucide-arrow-up')
    expect(sendButtonIcon(screen)).not.toContain('lucide-square')
    expect(runtime.stops).toHaveLength(0)

    await screen.getByRole('button', { name: 'Yes' }).click()

    await expect.element(screen.getByText(HITL_REPLY)).toBeVisible()
    await vi.waitFor(() => {
      expect(promptText(screen)).toContain('(complete)')
    })
    expect(runtime.runs).toHaveLength(2)

    const messages = runtime.runs[1]?.body.messages ?? []

    expect(messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'call-1', content: 'yes' }))
    const assistant = messages.find((message) => {
      return message.role === 'assistant'
    })

    expect(assistant?.toolCalls?.[0]?.function).toMatchObject({
      name: HITL_TOOL_CALL.name,
      arguments: JSON.stringify(HITL_TOOL_CALL.args),
    })
  })

  // Since react-core 1.7x `CopilotChat` queues a submit until the active run settles, and a run with
  // an open human-in-the-loop call settles only once it is answered.
  it('enter during the human-in-the-loop wait is held until the prompt is answered (FINDING-4)', async () => {
    runtime = installRuntimeScenario(scenarios.humanInTheLoop)

    const screen = await render(
      <AIChatContainer preset={NOMADREAM_PRESET} userName="Ada">
        <ConfirmBudget />
      </AIChatContainer>,
    )

    await send('budget?')
    await expect.element(screen.getByTestId('hitl-prompt')).toBeVisible()
    expect(promptText(screen)).toContain('(executing)')

    await send('while you wait')

    await expect.element(screen.getByRole('textbox')).toHaveValue('')
    expect(runtime.runs).toHaveLength(1)
    expect(promptText(screen)).toContain('(executing)')

    await screen.getByRole('button', { name: 'Yes' }).click()

    await vi.waitFor(() => {
      expect(runtime.runs).toHaveLength(3)
    })
    expect(runtime.runs[1]?.body.messages?.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-1' })
    expect(runtime.runs[2]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'while you wait' })
  })

  // The seam a consumer composer blocks FINDING-4 with: true exactly while the prompt waits.
  it('useAwaitingToolCall is true only while a human-in-the-loop call waits for its answer', async () => {
    runtime = installRuntimeScenario(scenarios.humanInTheLoop)

    const screen = await render(
      <AIChatContainer preset={NOMADREAM_PRESET} userName="Ada">
        <ConfirmBudget />
        <AwaitingProbe />
      </AIChatContainer>,
    )

    await expect.element(screen.getByTestId('awaiting-probe')).toBeInTheDocument()
    expect(awaitingText(screen)).toBe('false')

    await send('budget?')
    await expect.element(screen.getByTestId('hitl-prompt')).toBeVisible()
    await vi.waitFor(() => {
      expect(promptText(screen)).toContain('(executing)')
      expect(awaitingText(screen)).toBe('true')
    })

    await screen.getByRole('button', { name: 'Yes' }).click()

    await expect.element(screen.getByText(HITL_REPLY)).toBeVisible()
    await vi.waitFor(() => {
      expect(awaitingText(screen)).toBe('false')
    })
  })
})
