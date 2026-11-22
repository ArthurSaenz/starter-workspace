import { UseAgentUpdate, useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import type { ReactElement } from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { ConsoleLines } from '../__stories__/kit/errors-console-lines.js'
import { SeedTranscript } from '../__stories__/kit/seed-transcript.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { SHORT_EXCHANGE } from '../__stories__/kit/transcripts.js'
import { ChatFailureComponent } from '../components/chat-failure-component.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { describeChatFailure } from '../services/main.js'
import type { AiChatProps, ChatFailure, ChatFailureEvent, ChatFailureKind, ChatFailureLineProps } from '../types.js'
import {
  NOMADREAM_PRESET,
  PARTIAL_REPLY,
  REPLY,
  RUN_ERROR_MESSAGE,
  RUN_TIMEOUT_MESSAGE,
  installRuntimeScenario,
  scenarios,
} from './helpers/index.js'
import type { FakeRuntime, RuntimeScenario } from './helpers/index.js'

// The Errors and observability area: what its stories show, asserted. The stories open on a state;
// these check that each opens there and drive the transitions between states. The HTTP-error rows
// driven by typing, their console lines and the offline handshake live in ai-chat-states.test.tsx;
// the re-worded / custom / off line in ai-chat-root-container.test.tsx; the mapping in services.test.ts.

type Screen = Awaited<ReturnType<typeof render>>

const ERROR_LINE = 'ai-chat-error'
const USER_MESSAGE = 'copilot-user-message'
const ASSISTANT_MESSAGE = 'copilot-assistant-message'
const INSPECTOR = 'cpk-web-inspector'
const PROMPT = 'Plan a three-week stay in Bangkok for me.'

const SESSION_EXPIRED_TEXT = 'Your session has expired — sign in again to continue.'
const TOO_LONG_TEXT = 'This conversation got too long — start a new one.'
const THROTTLED_TEXT = 'Too many requests — give it a minute and try again.'
const UNAVAILABLE_TEXT = 'The assistant is unavailable right now. Please try again.'
const OFFLINE_TEXT = 'The assistant is unavailable right now. Reload the page to try again.'

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const expectErrorLine = async (screen: Screen, kind: ChatFailureKind, text: string) => {
  await expect.element(screen.getByTestId(ERROR_LINE)).toHaveAttribute('data-kind', kind)
  await expect.element(screen.getByTestId(ERROR_LINE)).toHaveTextContent(text)
}

const RunStatusBadge = () => {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnRunStatusChanged] })
  const [runsStarted, setRunsStarted] = useState(0)
  const [seenRunning, setSeenRunning] = useState(false)

  const isRunning = agent.isRunning

  if (isRunning !== seenRunning) {
    setSeenRunning(isRunning)

    if (isRunning) {
      setRunsStarted((count) => {
        return count + 1
      })
    }
  }

  return (
    <p data-testid="run-status">
      {isRunning ? 'running' : 'idle'} · runs started: {runsStarted}
    </p>
  )
}

const TranscriptBadge = () => {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnMessagesChanged] })
  const last = agent.messages.at(-1)

  return (
    <p data-testid="transcript">
      {agent.messages.length} ·{' '}
      {agent.messages
        .map((message) => {
          return message.role
        })
        .join(',')}{' '}
      · {typeof last?.content === 'string' ? last.content : ''}
    </p>
  )
}

const PlanButton = () => {
  const { agent } = useAgent()
  const { copilotkit } = useCopilotKit()

  return (
    <button
      type="button"
      onClick={() => {
        agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: PROMPT })
        void copilotkit.runAgent({ agent })
      }}
    >
      Plan my stay
    </button>
  )
}

interface TravellerSwitchProps {
  args: AiChatProps
}

const TravellerSwitch = (props: TravellerSwitchProps) => {
  const { args } = props

  const [traveller, setTraveller] = useState(1)

  return (
    <AIChat key={traveller} {...args}>
      <button
        type="button"
        onClick={() => {
          setTraveller((current) => {
            return current + 1
          })
        }}
      >
        Switch traveller
      </button>
      {traveller === 1 && <SeedTranscript messages={SHORT_EXCHANGE} />}
    </AIChat>
  )
}

type HostErrorBoxProps = ChatFailureLineProps

const HostErrorBox = (props: HostErrorBoxProps) => {
  return <div data-testid="host-error-box">{props.failure.kind}</div>
}

describe('errors and observability', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('error events', () => {
    const failedTurns: readonly (readonly [string, RuntimeScenario, ChatFailureKind, string])[] = [
      ['a RUN_ERROR frame', scenarios.runErrorThenRetry, 'run-error', RUN_ERROR_MESSAGE],
      ['a cut-short answer', scenarios.partialThenRunError, 'run-error', RUN_TIMEOUT_MESSAGE],
      ['HTTP 401', scenarios.http401, 'session-expired', SESSION_EXPIRED_TEXT],
      ['HTTP 413', scenarios.http413, 'too-long', TOO_LONG_TEXT],
      ['HTTP 429', scenarios.http429, 'throttled', THROTTLED_TEXT],
      ['HTTP 500', scenarios.http500, 'unavailable', UNAVAILABLE_TEXT],
    ]

    for (const [label, scenario, kind, text] of failedTurns) {
      it(`opens on the ${kind} line after ${label}`, async () => {
        runtime = installRuntimeScenario(scenario)
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const screen = await mount(
          <AIChat {...NOMADREAM_PRESET}>
            <StartRun message="hello" />
          </AIChat>,
        )

        await expectErrorLine(screen, kind, text)
        await expect.element(screen.getByTestId(USER_MESSAGE)).toHaveTextContent('hello')
        await expect.element(screen.getByRole('textbox')).not.toBeDisabled()
        expect(runtime.runs).toHaveLength(1)
      })
    }

    it('keeps the part of a cut-short answer that streamed', async () => {
      runtime = installRuntimeScenario(scenarios.partialThenRunError)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expectErrorLine(screen, 'run-error', RUN_TIMEOUT_MESSAGE)
      await expect.element(screen.getByTestId(ASSISTANT_MESSAGE)).toHaveTextContent(PARTIAL_REPLY)
    })

    it('opens on the offline line when the handshake fails, before anything is sent', async () => {
      runtime = installRuntimeScenario(scenarios.infoUnauthorized)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expectErrorLine(screen, 'offline', OFFLINE_TEXT)
      expect(runtime.runs).toHaveLength(0)
    })

    it('hands the host onError the failure the line shows and the raw event', async () => {
      runtime = installRuntimeScenario(scenarios.http429)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const received: (readonly [ChatFailure, ChatFailureEvent])[] = []

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          onError={(failure, event) => {
            received.push([failure, event])
          }}
        >
          <StartRun message="hello" />
        </AIChat>,
      )

      await expectErrorLine(screen, 'throttled', THROTTLED_TEXT)
      expect(received[0]?.[0]).toEqual({ kind: 'throttled', text: THROTTLED_TEXT })
      expect(received[0]?.[1].code).toBe('agent_run_failed_event')
      expect(received[0]?.[1].error).toMatchObject({ status: 429 })
    })
  })

  describe('failure taxonomy', () => {
    const httpError = (status: number): Error => {
      return Object.assign(new Error(`HTTP ${status}: {}`), { status })
    }

    // Keyed by the union so a kind added to `ChatFailureKind` without an event here fails to compile.
    const EVENT_FOR_KIND = {
      offline: { code: 'runtime_info_fetch_failed', error: new Error('Runtime info request failed with status 404') },
      'run-error': { code: 'agent_run_error_event', error: new Error(RUN_ERROR_MESSAGE) },
      'session-expired': { code: 'agent_run_failed_event', error: httpError(401) },
      'too-long': { code: 'agent_run_failed_event', error: httpError(413) },
      'not-kept': {
        code: 'agent_run_error_event',
        error: Object.assign(new Error('The conversation could not be continued.'), { code: 'CONVERSATION_NOT_KEPT' }),
      },
      throttled: { code: 'agent_run_failed_event', error: httpError(429) },
      'quota-exceeded': {
        code: 'agent_run_failed_event',
        error: Object.assign(new Error('HTTP 429: {"type":"DAILY_QUOTA_EXCEEDED"}'), { status: 429 }),
      },
      'quota-unavailable': {
        code: 'agent_run_failed_event',
        error: Object.assign(new Error('HTTP 503: {"type":"QUOTA_UNAVAILABLE"}'), { status: 503 }),
      },
      'budget-exhausted': {
        code: 'agent_run_failed_event',
        error: Object.assign(new Error('HTTP 503: {"type":"SERVICE_BUDGET_EXHAUSTED"}'), { status: 503 }),
      },
      'service-unavailable': {
        code: 'agent_run_error_event',
        error: Object.assign(new Error("NomaDream's assistant is temporarily unavailable."), {
          code: 'SERVICE_UNAVAILABLE',
        }),
      },
      'thread-running': {
        code: 'agent_run_error_event',
        error: Object.assign(new Error('This conversation is already answering in another window.'), {
          code: 'THREAD_RUNNING',
        }),
      },
      'transcription-failed': {
        code: 'transcription_network_error',
        error: new Error('Failed to fetch'),
      },
      'conversation-changed': {
        code: 'agent_run_error_event',
        error: Object.assign(new Error('Another tab saved first.'), { code: 'CONVERSATION_CHANGED' }),
      },
      unavailable: { code: 'agent_run_failed_event', error: httpError(500) },
    } satisfies Record<ChatFailureKind, ChatFailureEvent>

    it("tells the traveller the service is out of today's budget, from the HTTP body or a run error code", () => {
      const text = "The assistant has reached today's limit. Please try again tomorrow."

      expect(describeChatFailure(EVENT_FOR_KIND['budget-exhausted'])).toEqual({ kind: 'budget-exhausted', text })
      expect(
        describeChatFailure({
          code: 'agent_run_error_event',
          error: Object.assign(new Error('Out of budget.'), { code: 'SERVICE_BUDGET_EXHAUSTED' }),
        }),
      ).toEqual({ kind: 'budget-exhausted', text })
    })

    it('names a provider outage by its run error code, not by the run error text', () => {
      expect(describeChatFailure(EVENT_FOR_KIND['service-unavailable'])).toEqual({
        kind: 'service-unavailable',
        text: 'The assistant is temporarily unavailable. Please try again later.',
      })
    })

    it('names a chat answering in another tab, and a voice-input failure apart from a failed turn', () => {
      expect(describeChatFailure(EVENT_FOR_KIND['thread-running']).kind).toBe('thread-running')
      expect(describeChatFailure(EVENT_FOR_KIND['transcription-failed'])).toEqual({
        kind: 'transcription-failed',
        text: 'Voice input did not work this time. Try again, or type your question.',
      })
      expect(
        describeChatFailure({
          code: 'transcription_failed',
          error: Object.assign(new Error('HTTP 503: {"type":"SERVICE_BUDGET_EXHAUSTED"}'), { status: 503 }),
        }).text,
      ).toBe("Voice input has reached today's limit. Type your question instead.")
    })

    it('renders every kind through the line from the event the Lambda produces', async () => {
      const screen = await render(
        <div>
          {Object.values(EVENT_FOR_KIND).map((event) => {
            return <ChatFailureComponent key={event.error.message} failure={describeChatFailure(event)} />
          })}
        </div>,
      )

      const kinds = screen
        .getByRole('alert')
        .elements()
        .map((line) => {
          return line.getAttribute('data-kind')
        })

      expect(kinds).toEqual(Object.keys(EVENT_FOR_KIND))
    })
  })

  describe('reachability probe mid-run', () => {
    // CopilotKit probes `/info` when a request has no response after 10 s, and gives the probe 5 s.
    // A buffered run on API Gateway answers only at its end, and a cold Lambda misses the 5 s.
    it('shows nothing when the probe fails while a run that later answers is in flight', async () => {
      runtime = installRuntimeScenario({
        info: 'fails-after-handshake',
        run: { kind: 'reply', text: REPLY, delayMs: 11_000 },
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await send(screen, PROMPT)
      await expect.element(screen.getByText(REPLY), { timeout: 20_000 }).toBeVisible()

      const infoRequests = runtime.requests.filter((request) => {
        return request.path === '/info'
      })

      expect(infoRequests.length).toBeGreaterThan(1)
      expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()
    }, 30_000)
  })

  describe('traveller error line', () => {
    it('a custom line replaces the package line rather than joining it', async () => {
      runtime = installRuntimeScenario(scenarios.http500)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} features={{ errorLine: HostErrorBox }}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('host-error-box')).toHaveTextContent('unavailable')
      expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()
    })

    it("words the package line with the consumer's failureText", async () => {
      runtime = installRuntimeScenario(scenarios.http500)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} failureText={{ unavailable: 'Acme is unavailable.' }}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByTestId(ERROR_LINE)).toHaveTextContent('Acme is unavailable.')
    })
  })

  describe('console re-emit', () => {
    it('mirrors the handshake failure as the only line, with CopilotKit’s own silenced', async () => {
      runtime = installRuntimeScenario(scenarios.infoUnauthorized)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ConsoleLines method="error" prefix="[" title="errors" />
        </AIChat>,
      )

      await expect
        .element(
          screen.getByText(/\[ai-chat\] runtime_info_fetch_failed: Error: Runtime info request failed with status 404/),
        )
        .toBeVisible()
      await sleep(500)
      expect(screen.getByText(/\[CopilotKit\] Error/).query()).toBeNull()
      expect(runtime.requests[0]).toMatchObject({ method: 'GET', path: '/info' })
    })
  })

  describe('debug logging', () => {
    it('writes no lifecycle lines by default', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ConsoleLines method="debug" prefix="[LIFECYCLE]" title="lifecycle" />
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await sleep(500)
      await expect.element(screen.getByText('nothing logged yet')).toBeVisible()
    })

    it('provider.debug logs the run lifecycle naming the chat’s agent', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ debug: true }}>
          <ConsoleLines method="debug" prefix="[LIFECYCLE]" title="lifecycle" />
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect
        .element(screen.getByText(/\[LIFECYCLE\] Run started: .*"agentId":"travelAiAgent"/))
        .toBeInTheDocument()
    })
  })

  describe('inspector', () => {
    // CopilotKit mounts it only when NODE_ENV is `development`; the vitest runner is `test`, so this
    // pins that a consumer's flag never mounts it outside development — and that it is off by default.
    for (const enableInspector of [undefined, true]) {
      it(`mounts no inspector outside development (enableInspector: ${enableInspector})`, async () => {
        runtime = installRuntimeScenario(scenarios.default)

        const screen = await mount(<AIChat {...NOMADREAM_PRESET} provider={{ enableInspector }} />)

        await expect.element(screen.getByTestId('copilot-chat')).toBeVisible()
        // The lazy import would have resolved well within this window (≈ 200 ms when it mounts).
        await sleep(1000)
        expect(document.querySelector(INSPECTOR)).toBeNull()
      })
    }
  })

  describe('run status', () => {
    it('a children badge sees the turn running', async () => {
      runtime = installRuntimeScenario(scenarios.thinking)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <RunStatusBadge />
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('run-status')).toHaveTextContent('running · runs started: 1')
    })

    it('counts a failed run, then the retry that clears the line', async () => {
      runtime = installRuntimeScenario(scenarios.runErrorThenRetry)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <RunStatusBadge />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('run-status')).toHaveTextContent('idle · runs started: 0')

      await send(screen, 'hello')
      await expectErrorLine(screen, 'run-error', RUN_ERROR_MESSAGE)
      await expect.element(screen.getByTestId('run-status')).toHaveTextContent('idle · runs started: 1')

      await send(screen, 'once more')
      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('run-status')).toHaveTextContent('idle · runs started: 2')
      expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()
      expect(runtime.runs).toHaveLength(2)
    })
  })

  describe('programmatic run', () => {
    it('a button outside the composer sends a turn without touching the textarea', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <PlanButton />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('copilot-chat')).toBeVisible()
      await screen.getByRole('button', { name: 'Plan my stay' }).click()

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByTestId(USER_MESSAGE)).toHaveTextContent(PROMPT)
      await expect.element(screen.getByRole('textbox')).toHaveValue('')
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: PROMPT })
    })
  })

  describe('read the transcript', () => {
    it('children read the same messages the chat shows, and see them grow', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <TranscriptBadge />
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('transcript')).toHaveTextContent(`2 · user,assistant · ${REPLY}`)

      await send(screen, 'and the rainy season?')

      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(1)
      })
      await expect
        .element(screen.getByTestId('transcript'))
        .toHaveTextContent(`4 · user,assistant,user,assistant · ${REPLY}`)
    })
  })

  describe('reset on user switch', () => {
    it('a new key clears the chat, re-handshakes and starts a new thread', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const infoCount = () => {
        return runtime.requests.filter((request) => {
          return request.path === '/info'
        }).length
      }

      const screen = await mount(<TravellerSwitch args={{ ...NOMADREAM_PRESET }} />)

      await expect.element(screen.getByTestId(USER_MESSAGE)).toHaveTextContent('hello')
      await send(screen, 'first traveller')
      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(1)
      })
      expect(infoCount()).toBe(1)

      await screen.getByRole('button', { name: 'Switch traveller' }).click()

      await expect.element(page.getByTestId('copilot-welcome-screen')).toBeVisible()
      expect(screen.getByTestId(USER_MESSAGE).query()).toBeNull()
      expect(screen.getByTestId(ASSISTANT_MESSAGE).query()).toBeNull()
      await vi.waitFor(() => {
        expect(infoCount()).toBe(2)
      })

      await send(screen, 'hello again')
      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(2)
      })
      expect(runtime.runs[1]?.body.threadId).toEqual(expect.any(String))
      expect(runtime.runs[1]?.body.threadId).not.toBe(runtime.runs[0]?.body.threadId)
      expect(runtime.runs[1]?.body.messages).toHaveLength(1)
    })
  })
})
