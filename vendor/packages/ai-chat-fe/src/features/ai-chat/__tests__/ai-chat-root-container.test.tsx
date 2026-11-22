import { useCopilotChatConfiguration } from '@copilotkit/react-core/v2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { AIChatRootContainer } from '../containers/ai-chat-root-container.js'
import type { ChatFailure, ChatFailureLineProps } from '../types.js'
import { NOMADREAM_PRESET, REPLY, installFakeRuntime, installRuntimeScenario, scenarios } from './helpers/index.js'

// Reads the configuration context the way a consumer's `children` would.
const ConfigProbe = () => {
  const configuration = useCopilotChatConfiguration()

  return (
    <p data-testid="config-probe" data-agent-id={configuration?.agentId}>
      {configuration?.labels.chatInputPlaceholder}
    </p>
  )
}

const send = async (screen: Awaited<ReturnType<typeof render>>, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

describe('aIChatRootContainer', () => {
  let runtime: ReturnType<typeof installFakeRuntime>

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  it('wraps children in the chat configuration context: agent id and merged labels are readable', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(
      <AIChatRootContainer {...NOMADREAM_PRESET} chat={{ labels: { chatInputPlaceholder: 'Type here' } }}>
        <ConfigProbe />
      </AIChatRootContainer>,
    )

    await expect.element(screen.getByTestId('config-probe')).toHaveAttribute('data-agent-id', 'travelAiAgent')
    await expect.element(screen.getByTestId('config-probe')).toHaveTextContent('Type here')
    await expect.element(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Type here')
  })

  it('is identified by data-ai-chat only, with the structural layout from styles.css', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(<AIChatRootContainer {...NOMADREAM_PRESET} className="host-class" />)

    const wrapper = screen.getByTestId('ai-chat').element()

    expect(wrapper.getAttribute('data-ai-chat')).toBeTruthy()
    expect(wrapper.classList.contains('ai-chat')).toBe(false)
    expect(wrapper.classList.contains('host-class')).toBe(true)
    expect(getComputedStyle(wrapper).display).toBe('flex')
    expect(getComputedStyle(wrapper).flexDirection).toBe('column')

    await expect.element(screen.getByTestId('copilot-chat')).toBeVisible()

    const chat = screen.getByTestId('copilot-chat').element()

    expect(getComputedStyle(chat).minHeight).toBe('0px')
  })

  it('injects the theme tokens scoped to this instance and the dark class on the wrapper', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(
      <AIChatRootContainer {...NOMADREAM_PRESET} theme={{ tokens: { background: 'rgb(1, 2, 3)' }, dark: true }} />,
    )

    const wrapper = screen.getByTestId('ai-chat').element()
    const id = wrapper.getAttribute('data-ai-chat')

    expect(wrapper.classList.contains('dark')).toBe(true)
    expect(wrapper.querySelector('style')?.textContent).toBe(
      `[data-ai-chat="${id}"] [data-copilotkit]{--background:rgb(1, 2, 3)}`,
    )

    const root = wrapper.querySelector('[data-copilotkit]')

    expect(root).not.toBeNull()
    expect(
      getComputedStyle(root as Element)
        .getPropertyValue('--background')
        .trim(),
    ).toBe('rgb(1, 2, 3)')
  })

  it('registers each context entry and the pills for the configured agent', async () => {
    runtime = installFakeRuntime(REPLY)

    const screen = await render(
      <AIChatRootContainer
        {...NOMADREAM_PRESET}
        context={[
          { description: 'first', value: 'one' },
          { description: 'second', value: 2 },
        ]}
      />,
    )

    await expect.element(screen.getByText('Plan a long stay')).toBeVisible()
    await send(screen, 'hi')
    await expect.element(screen.getByText(REPLY)).toBeVisible()

    expect(runtime.runs[0]?.url).toContain('/agent/travelAiAgent/run')
    expect(runtime.runs[0]?.body.context).toContainEqual({ description: 'first', value: 'one' })
    // CopilotKit stringifies a non-string context value before it goes on the wire.
    expect(runtime.runs[0]?.body.context).toContainEqual({ description: 'second', value: '2' })
  })

  it('renders a re-worded error line, reports the failure through onError, and clears it on the next run', async () => {
    runtime = installRuntimeScenario(scenarios.http401)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const failures: ChatFailure[] = []

    const screen = await render(
      <AIChatRootContainer
        {...NOMADREAM_PRESET}
        features={{ errorLine: { text: { 'session-expired': 'Log in again.' } } }}
        onError={(failure) => {
          failures.push(failure)
        }}
      />,
    )

    await send(screen, 'hello')

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Log in again.')
    await expect.element(screen.getByRole('alert')).toHaveAttribute('data-kind', 'session-expired')
    expect(failures[0]).toEqual({ kind: 'session-expired', text: 'Log in again.' })
    expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'hello' })

    runtime.restore()
    runtime = installFakeRuntime(REPLY)

    await send(screen, 'again')

    await expect.element(screen.getByText(REPLY)).toBeVisible()
    expect(screen.getByRole('alert').query()).toBeNull()
  })

  it('renders a custom error line component, or nothing when the line is off', async () => {
    runtime = installRuntimeScenario(scenarios.http500)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    type CustomLineProps = ChatFailureLineProps

    const CustomLine = (props: CustomLineProps) => {
      return <em data-testid="custom-line">{props.failure.kind}</em>
    }

    const custom = await render(<AIChatRootContainer {...NOMADREAM_PRESET} features={{ errorLine: CustomLine }} />)

    await send(custom, 'boom')
    await expect.element(custom.getByTestId('custom-line')).toHaveTextContent('unavailable')

    custom.unmount()
    runtime.restore()
    runtime = installRuntimeScenario(scenarios.http500)

    const off = await render(<AIChatRootContainer {...NOMADREAM_PRESET} features={{ errorLine: false }} />)

    await send(off, 'boom')
    // The run has failed once the second, generic `agent_run_failed` re-emit lands.
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith('[ai-chat] agent_run_failed:', expect.anything())
    })
    expect(off.getByRole('alert').query()).toBeNull()
    expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'boom' })
  })
})
