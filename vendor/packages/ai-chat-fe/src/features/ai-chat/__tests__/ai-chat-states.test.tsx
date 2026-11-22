import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { AIChatContainer } from '../containers/ai-chat-container.js'
import {
  GENERIC_ERROR_BODY,
  MARKDOWN_REPLY,
  NOMADREAM_PRESET,
  NOT_FOUND_BODY,
  PARTIAL_REPLY,
  PAYLOAD_TOO_LARGE_BODY,
  REPLY,
  RUN_ERROR_MESSAGE,
  RUN_TIMEOUT_MESSAGE,
  SUGGESTION_REPLY,
  TOO_MANY_REQUESTS_BODY,
  UNAUTHORIZED_BODY,
  installRuntimeScenario,
  scenarios,
} from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// Titles are the plan §5 inventory names. Where CopilotKit v2 renders differently from what the
// title implies, the body asserts what W2 observed and a comment says so — the title is the
// audit row, the assertions are the truth.
//
// W2 finding that shapes every error case below: the v2 `CopilotKitProvider` has NO error UI of
// its own. Without an `onError` prop it only does `console.error('[CopilotKit] Error (<code>):', …)`
// (react-core/dist/copilotkit-*.mjs, the `copilotkit.subscribe({ onError })` effect), and the
// `copilot-error-banner` toast belongs to the v1 `ToastProvider`, which v2 never mounts. This
// package therefore renders its own line through the provider `onError` (`ai-chat-error`, see
// ../services.ts) and re-emits the failure as `console.error('[ai-chat] <code>:', error)` —
// once a handler is supplied CopilotKit's own `[CopilotKit] Error` line is gone. The wire body is
// still proven through that console line; the traveller-facing text is proven on the alert.

const ERROR_LINE = 'ai-chat-error'
const CURSOR = 'copilot-loading-cursor'

// The texts of ../services.ts as the traveller reads them — repeated here on purpose so a
// copy change fails the row that shows it.
const SESSION_EXPIRED_TEXT = 'Your session has expired — sign in again to continue.'
const TOO_LONG_TEXT = 'This conversation got too long — start a new one.'
const THROTTLED_TEXT = 'Too many requests — give it a minute and try again.'
const UNAVAILABLE_TEXT = 'The assistant is unavailable right now. Please try again.'
const OFFLINE_TEXT = 'The assistant is unavailable right now. Reload the page to try again.'

const PLAN_LONG_STAY = 'I am planning a 3-week stay in Lisbon. How should I think about the total cost?'

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (text: string) => {
  await page.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const stringify = (arg: unknown): string => {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (typeof arg === 'string') return arg

  return JSON.stringify(arg)
}

describe('aIChatContainer states (plan §5 rows 2–20)', () => {
  let runtime: FakeRuntime
  let consoleErrors: string[]

  const errorLog = () => {
    return consoleErrors.join('\n')
  }

  const waitForConsoleError = async (fragment: string) => {
    await vi.waitFor(() => {
      expect(errorLog()).toContain(fragment)
    })
  }

  beforeEach(() => {
    consoleErrors = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(stringify).join(' '))
    })
  })

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  it('shows the placeholder and no disclaimer under the input', async () => {
    runtime = installRuntimeScenario(scenarios.default)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await expect.element(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask anything…')
    expect(screen.getByText(/can make mistakes/).query()).toBeNull()
    expect(screen.getByText('AI can make mistakes. Please verify important information.').query()).toBeNull()
  })

  it('a consumer can bring the disclaimer back through chat overrides', async () => {
    runtime = installRuntimeScenario(scenarios.default)

    const Disclaimer = () => {
      return <p>Check the numbers.</p>
    }

    const screen = await render(
      <AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" chat={{ input: { disclaimer: Disclaimer } }} />,
    )

    await expect.element(screen.getByText('Check the numbers.')).toBeVisible()
    // The override merges key by key: the default labels survive next to the new slot.
    await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
    await expect.element(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask anything…')
  })

  it('renders the three suggestions before the first message', async () => {
    runtime = installRuntimeScenario(scenarios.default)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await expect.element(screen.getByText('Plan a long stay')).toBeVisible()
    await expect.element(screen.getByText('Compare programmes')).toBeVisible()
    await expect.element(screen.getByText('Elite status')).toBeVisible()
    expect(runtime.runs).toHaveLength(0)
  })

  // FINDING-1 regression: the pills were registered for agent `default` because the hook runs
  // outside <CopilotChat agentId>; only the shipped container (not a hand-built tree) proves the
  // `consumerAgentId` wiring.
  it('the shipped container renders its suggestion pills for the chat agent (FINDING-1)', async () => {
    runtime = installRuntimeScenario(scenarios.default)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await expect.element(screen.getByTestId('copilot-suggestions')).toBeVisible()
    await vi.waitFor(() => {
      expect(screen.getByTestId('copilot-suggestion').elements()).toHaveLength(3)
    })
    expect(screen.getByTestId('copilot-user-message').query()).toBeNull()
  })

  it('a clicked suggestion is sent as the user message', async () => {
    runtime = installRuntimeScenario(scenarios.suggestionClick)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await screen.getByText('Plan a long stay').click()

    await expect.element(screen.getByText(SUGGESTION_REPLY)).toBeVisible()
    // The pill's `message`, not its `title`, is what the traveller "said".
    await expect.element(screen.getByTestId('copilot-user-message')).toHaveTextContent(PLAN_LONG_STAY)
    expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: PLAN_LONG_STAY })
    expect(screen.getByText('Compare programmes').query()).toBeNull()
  })

  it('renders a long markdown reply', async () => {
    runtime = installRuntimeScenario(scenarios.markdownReply)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('three weeks in Bangkok')

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Three weeks in Bangkok — the honest total' }))
      .toBeVisible()
    await expect.element(screen.getByRole('heading', { level: 2, name: 'Bottom line' })).toBeVisible()
    await expect.element(screen.getByRole('cell', { name: 'Long-stay discount (15%)' })).toBeVisible()
    await expect.element(screen.getByText('const longStayDiscount = 0.15')).toBeVisible()
    // Rendered, not echoed: no markdown syntax survives as text.
    expect(screen.getByText('## What moves the number').query()).toBeNull()
    expect(runtime.runs).toHaveLength(1)
    expect(MARKDOWN_REPLY.split('\n').length).toBeGreaterThan(40)
  })

  it('an empty reply leaves the chat usable', async () => {
    runtime = installRuntimeScenario(scenarios.emptyReply)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('hello')

    await expect.element(screen.getByTestId('copilot-user-message')).toHaveTextContent('hello')
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    expect(runtime.runs).toHaveLength(1)
    // W2: nothing at all is rendered for the turn — no assistant bubble, no error line, no console.error.
    expect(screen.getByTestId('copilot-assistant-message').query()).toBeNull()
    expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()
    expect(consoleErrors).toEqual([])

    await send('again')
    await vi.waitFor(() => {
      expect(runtime.runs).toHaveLength(2)
    })
  })

  it('shows the loading cursor while the run is open', async () => {
    runtime = installRuntimeScenario(scenarios.thinking)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('hello')

    await expect.element(screen.getByTestId(CURSOR)).toBeVisible()
    // W2: the textarea stays enabled while running; the send button is re-purposed as the stop
    // button in place (same testid, `lucide-square` icon) rather than disabled.
    await expect.element(screen.getByRole('textbox')).not.toBeDisabled()
    await expect.element(screen.getByTestId('copilot-send-button')).not.toBeDisabled()
    expect(screen.getByTestId('copilot-send-button').element().querySelector('svg.lucide-square')).not.toBeNull()

    // W2: Enter WITH text while running neither sends nor stops — CopilotChatInput calls send(),
    // the input is cleared, and no second run leaves the browser (the typed text is lost).
    await send('second')
    await sleep(500)
    expect(runtime.runs).toHaveLength(1)
    expect(runtime.stops).toHaveLength(0)
    await expect.element(screen.getByRole('textbox')).toHaveValue('')
    await expect.element(screen.getByTestId(CURSOR)).toBeVisible()
  })

  it('stop posts the stop route but never aborts the run (FINDING-3)', async () => {
    // Same scenario as the story with a shorter reply delay: long enough to observe the stop
    // click while the run is open, short enough for the suite.
    runtime = installRuntimeScenario({
      ...scenarios.stopGeneration,
      run: { kind: 'reply', text: REPLY, delayMs: 1200 },
    })

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('hello')
    await expect.element(screen.getByTestId(CURSOR)).toBeVisible()

    await screen.getByTestId('copilot-send-button').click()

    await vi.waitFor(() => {
      expect(runtime.stops).toHaveLength(1)
    })
    const threadId = runtime.runs[0]?.body.threadId

    expect(threadId).toBeTruthy()
    expect(runtime.stops[0]?.threadId).toBe(threadId)
    expect(runtime.stops[0]?.url).toContain(`/api/v1/ai/copilotkit/agent/travelAiAgent/stop/${threadId}`)

    // W2 / FINDING-3: "aborts the run" is react-core's name for the action (`abortRun`), not what
    // reaches the wire. `ProxiedCopilotRuntimeAgent.abortRun` (@copilotkit/core 1.90.0) overrides
    // `HttpAgent.abortRun` without calling it, so the run fetch's AbortController never fires and
    // the chat stays "running" — cursor on, stop icon on — right after the click.
    await expect.element(screen.getByTestId(CURSOR)).toBeVisible()
    expect(screen.getByTestId('copilot-send-button').element().querySelector('svg.lucide-square')).not.toBeNull()

    // The run ends only when the server's response lands: the reply renders and the cursor clears.
    await expect.element(screen.getByText(REPLY)).toBeVisible()
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    expect(runtime.runs).toHaveLength(1)
    expect(consoleErrors).toEqual([])
  })

  const expectErrorLine = async (screen: Awaited<ReturnType<typeof render>>, kind: string, text: string) => {
    await expect.element(screen.getByTestId(ERROR_LINE)).toBeVisible()
    await expect.element(screen.getByTestId(ERROR_LINE)).toHaveAttribute('data-kind', kind)
    await expect.element(screen.getByTestId(ERROR_LINE)).toHaveTextContent(text)
  }

  it("a RUN_ERROR frame shows the Lambda's message under the chat", async () => {
    runtime = installRuntimeScenario(scenarios.runError)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('hello')

    await expectErrorLine(screen, 'run-error', RUN_ERROR_MESSAGE)
    await waitForConsoleError(`[ai-chat] agent_run_error_event: Error: ${RUN_ERROR_MESSAGE}`)
    // Supplying `onError` silences CopilotKit's own line; ours is the only one now.
    expect(errorLog()).not.toContain('[CopilotKit] Error')
    // The line is this package's, not the v1 toast (never mounted by v2).
    expect(page.getByTestId('copilot-error-banner').query()).toBeNull()
    expect(screen.getByTestId('copilot-assistant-message').query()).toBeNull()
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    await expect.element(screen.getByTestId('copilot-user-message')).toHaveTextContent('hello')
    await expect.element(screen.getByRole('textbox')).not.toBeDisabled()

    // Usable afterwards; the second run fails the same way, so the line is shown again.
    await send('again')
    await vi.waitFor(() => {
      expect(runtime.runs).toHaveLength(2)
    })
    await expectErrorLine(screen, 'run-error', RUN_ERROR_MESSAGE)
  })

  it('partial text survives a trailing RUN_ERROR and the watchdog text marks it as cut short', async () => {
    runtime = installRuntimeScenario(scenarios.partialThenRunError)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('rainy season?')

    // The partial stays in the assistant bubble; the watchdog's sentence sits under the chat.
    await expect.element(screen.getByText(PARTIAL_REPLY)).toBeVisible()
    await expectErrorLine(screen, 'run-error', RUN_TIMEOUT_MESSAGE)
    await waitForConsoleError(`[ai-chat] agent_run_error_event: Error: ${RUN_TIMEOUT_MESSAGE}`)
    await expect.element(screen.getByTestId('copilot-assistant-message')).toHaveTextContent(PARTIAL_REPLY)
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    await expect.element(screen.getByRole('textbox')).not.toBeDisabled()
  })

  it('the chat recovers after a RUN_ERROR and the error line clears with the next run', async () => {
    runtime = installRuntimeScenario(scenarios.runErrorThenRetry)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('hello')
    await expectErrorLine(screen, 'run-error', RUN_ERROR_MESSAGE)
    await waitForConsoleError('[ai-chat] agent_run_error_event:')

    await send('once more')

    await expect.element(screen.getByText(REPLY)).toBeVisible()
    // The new turn retired the failure: no line under the reply.
    await expect.element(screen.getByTestId(ERROR_LINE)).not.toBeInTheDocument()
    expect(runtime.runs).toHaveLength(2)
    expect(runtime.runs[1]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'once more' })
  })

  // Run HTTP errors: @ag-ui/client's fetch wrapper throws `Error("HTTP <status>: <body>")` with
  // `.status` attached → core `onRunFailed` → `emitAgentError` → the provider `onError`. Three
  // console lines per failure (`[ai-chat] agent_run_failed_event`, ag-ui's own
  // "Agent execution failed:", `[ai-chat] agent_run_failed`) — `onError` fires for both codes.
  const httpCases = [
    [
      'a 401 run surfaces the unauthorized body',
      scenarios.http401,
      401,
      UNAUTHORIZED_BODY,
      'session-expired',
      SESSION_EXPIRED_TEXT,
    ],
    ['a 404 run surfaces the not-found body', scenarios.http404, 404, NOT_FOUND_BODY, 'unavailable', UNAVAILABLE_TEXT],
    [
      'a 413 run surfaces the payload-too-large body',
      scenarios.http413,
      413,
      PAYLOAD_TOO_LARGE_BODY,
      'too-long',
      TOO_LONG_TEXT,
    ],
    [
      'a 429 run surfaces the throttle body',
      scenarios.http429,
      429,
      TOO_MANY_REQUESTS_BODY,
      'throttled',
      THROTTLED_TEXT,
    ],
    ['a 500 run surfaces a server error', scenarios.http500, 500, GENERIC_ERROR_BODY, 'unavailable', UNAVAILABLE_TEXT],
  ] as const

  for (const [title, scenario, status, body, kind, text] of httpCases) {
    it(title, async () => {
      runtime = installRuntimeScenario(scenario)

      const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

      await send('hello')

      await expectErrorLine(screen, kind, text)
      await waitForConsoleError(`[ai-chat] agent_run_failed_event: Error: HTTP ${status}: ${body}`)
      expect(errorLog()).toContain(`Agent execution failed: Error: HTTP ${status}: ${body}`)
      expect(errorLog()).toContain(`[ai-chat] agent_run_failed: Error: HTTP ${status}: ${body}`)
      // No assistant bubble — the traveller sees their own message and the line under the chat.
      expect(screen.getByTestId('copilot-assistant-message').query()).toBeNull()
      await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
      await expect.element(screen.getByTestId('copilot-user-message')).toHaveTextContent('hello')
      await expect.element(screen.getByRole('textbox')).not.toBeDisabled()

      await send('again')
      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(2)
      })
      await expectErrorLine(screen, kind, text)
    })
  }

  it('a 401 /info is swallowed by the auto transport — welcome renders with the offline line, Enter is dead', async () => {
    runtime = installRuntimeScenario(scenarios.infoUnauthorized)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    // W2: transport "auto" tries GET /info, swallows the non-2xx, then falls back to the
    // single-endpoint POST <runtimeUrl> {method:"info"} — which the Lambda allow-list (and the
    // fake) 404s. So a 401 on /info is reported as a 404, once, through the provider `onError`.
    await expectErrorLine(screen, 'offline', OFFLINE_TEXT)
    await waitForConsoleError('[ai-chat] runtime_info_fetch_failed: Error: Runtime info request failed with status 404')
    // The chat still boots to its welcome screen with an enabled textarea …
    await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
    await expect.element(screen.getByRole('textbox')).not.toBeDisabled()

    // … but Enter does nothing: no run, no user bubble, the text stays in the box — and since no
    // run starts, the offline line stays too.
    await send('hello')
    await sleep(500)
    expect(runtime.runs).toHaveLength(0)
    expect(screen.getByTestId('copilot-user-message').query()).toBeNull()
    await expect.element(screen.getByRole('textbox')).toHaveValue('hello')
    await expectErrorLine(screen, 'offline', OFFLINE_TEXT)
  })

  // The send button stayed disabled for good after one failed handshake: CopilotKit never retries
  // `/info` on its own, so the agent was never registered and the chat withheld its submit handler.
  it('a /info that fails once is retried — the send button comes back and the offline line clears', async () => {
    runtime = installRuntimeScenario(scenarios.infoUnauthorizedOnce)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await expectErrorLine(screen, 'offline', OFFLINE_TEXT)
    await page.getByRole('textbox').fill(PLAN_LONG_STAY)
    await expect.element(screen.getByTestId('copilot-send-button')).toBeDisabled()

    await expect.element(screen.getByTestId('copilot-send-button'), { timeout: 5000 }).toBeEnabled()
    expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()

    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => {
      expect(runtime.runs).toHaveLength(1)
    })
  })

  it('a network failure surfaces the unavailable line and re-enables input', async () => {
    runtime = installRuntimeScenario(scenarios.networkError)

    const screen = await render(<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />)

    await send('hello')

    await expectErrorLine(screen, 'unavailable', UNAVAILABLE_TEXT)
    await waitForConsoleError('[ai-chat] agent_run_failed_event: TypeError: Failed to fetch')
    await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
    await expect.element(screen.getByRole('textbox')).not.toBeDisabled()

    await send('again')
    await vi.waitFor(() => {
      expect(runtime.runs).toHaveLength(2)
    })
    await expectErrorLine(screen, 'unavailable', UNAVAILABLE_TEXT)
  })
})
