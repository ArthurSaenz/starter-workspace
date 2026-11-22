import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { AIChatContainer } from '../containers/ai-chat-container.js'
import { NOMADREAM_PRESET, REPLY, installFakeRuntime } from './helpers/index.js'

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Awaited<ReturnType<typeof render>>, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

describe('aIChatContainer (client /chat surface)', () => {
  let runtime: ReturnType<typeof installFakeRuntime>

  afterEach(() => {
    runtime.restore()
  })

  it('renders the chat with the NomaDream welcome text', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} />)

    await expect.element(screen.getByTestId('ai-chat')).toBeVisible()
    await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
  })

  it('sends the traveller name as agent context to travelAiAgent and renders the buffered reply', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send(screen, 'what is my name?')

    await expect.element(screen.getByText(REPLY)).toBeVisible()

    const run = runtime.runs[0]

    expect(run?.url).toContain('/api/v1/ai/copilotkit/agent/travelAiAgent/run')
    expect(run?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'what is my name?' })
    expect(run?.body.context).toContainEqual({ description: 'Name of the signed-in traveller', value: 'Ada' })
  })

  it('sends the same-origin request with credentials so the session cookie reaches the runtime', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send(screen, 'hello')
    await expect.element(screen.getByText(REPLY)).toBeVisible()

    expect(runtime.runs).toHaveLength(1)
    expect(runtime.runs[0]?.credentials).toBe('same-origin')
  })
})
