import { useCopilotChatConfiguration, useThreads } from '@copilotkit/react-core/v2'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { NOMADREAM_PRESET, REPLY, installRuntimeScenario, scenarios } from './helpers/index.js'
import type { FakeRuntime, KeptThread } from './helpers/index.js'

// The Threads area: what its stories describe, asserted against the fake Lambda — which, like the
// real one, keeps every finished run and replays it on `/connect` and lists it on `GET /threads`.

type Screen = Awaited<ReturnType<typeof render>>

const USER_MESSAGE = 'copilot-user-message'
const ASSISTANT_MESSAGE = 'copilot-assistant-message'
const WELCOME_SCREEN = 'copilot-welcome-screen'
const ERROR_LINE = 'ai-chat-error'
const CONNECTING_INDICATOR = 'copilot-connecting-indicator'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESTORED_THREAD_ID = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5'
const KEPT_QUESTION = 'three weeks in Bangkok'
const KEPT_ANSWER = 'Plan on the long-stay rate.'

const KEPT_THREAD: KeptThread = {
  id: RESTORED_THREAD_ID,
  name: KEPT_QUESTION,
  messages: [
    { id: 'kept-user', role: 'user', content: KEPT_QUESTION },
    { id: 'kept-assistant', role: 'assistant', content: KEPT_ANSWER },
  ],
  updatedAt: '2026-10-01T10:00:00.000Z',
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

const waitForRuns = async (runtime: FakeRuntime, count: number) => {
  await vi.waitFor(() => {
    expect(runtime.runs).toHaveLength(count)
  })
}

// react-core may connect a thread more than once while the chat boots (each replay is a full
// snapshot, so a repeat is harmless); what matters is which threads it asked for.
const connectedThreads = (runtime: FakeRuntime): Array<string | undefined> => {
  return [
    ...new Set(
      runtime.connects.map((connect) => {
        return connect.threadId
      }),
    ),
  ]
}

const ThreadIdBadge = () => {
  const configuration = useCopilotChatConfiguration()

  return <code data-testid="thread-id">{configuration?.threadId}</code>
}

const RemountableChat = () => {
  const [mountCount, setMountCount] = useState(0)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMountCount((previous) => {
            return previous + 1
          })
        }}
      >
        Remount
      </button>
      <AIChat key={mountCount} {...NOMADREAM_PRESET}>
        <ThreadIdBadge />
      </AIChat>
    </>
  )
}

const NewThreadButton = () => {
  const configuration = useCopilotChatConfiguration()

  return (
    <button
      type="button"
      onClick={() => {
        configuration?.startNewThread()
      }}
    >
      New thread
    </button>
  )
}

const ThreadList = () => {
  const { threads, listError } = useThreads({ agentId: 'travelAiAgent' })
  const configuration = useCopilotChatConfiguration()

  return (
    <div>
      {threads.map((thread) => {
        return (
          <button
            key={thread.id}
            type="button"
            data-testid="thread-row"
            onClick={() => {
              configuration?.setActiveThreadId(thread.id)
            }}
          >
            {thread.name ?? thread.id}
          </button>
        )
      })}
      {listError ? <p data-testid="threads-error">{listError.message}</p> : null}
    </div>
  )
}

describe('threads', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('auto thread id', () => {
    it('mints one UUID per mount, carried by every run, and a new one on remount', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<RemountableChat />)

      await expect.element(screen.getByTestId('thread-id')).toMatchTextContent(UUID)
      const first = screen.getByTestId('thread-id').element().textContent

      await send(screen, 'hello')
      await waitForRuns(runtime, 1)
      expect(runtime.runs[0]?.body.threadId).toBe(first)
      await expect.element(screen.getByText(REPLY)).toBeVisible()

      await send(screen, 'again')
      await waitForRuns(runtime, 2)
      expect(runtime.runs[1]?.body.threadId).toBe(first)

      await screen.getByRole('button', { name: 'Remount' }).click()

      await expect.element(screen.getByTestId('thread-id')).not.toHaveTextContent(first ?? '')
      const second = screen.getByTestId('thread-id').element().textContent

      expect(second).toMatch(UUID)
      expect(screen.getByTestId(USER_MESSAGE).query()).toBeNull()

      await send(screen, 'fresh start')
      await waitForRuns(runtime, 3)
      expect(runtime.runs[2]?.body.threadId).toBe(second)
    })
  })

  describe('switch or new thread', () => {
    it('startNewThread empties the view and the next run goes out on a new thread with no history', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <NewThreadButton />
        </AIChat>,
      )

      await send(screen, 'hello')
      await expect.element(screen.getByText(REPLY)).toBeVisible()

      await screen.getByRole('button', { name: 'New thread' }).click()

      await expect.element(screen.getByTestId(USER_MESSAGE)).not.toBeInTheDocument()
      expect(screen.getByTestId(ASSISTANT_MESSAGE).query()).toBeNull()
      await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()

      await send(screen, 'again')
      await waitForRuns(runtime, 2)

      const first = runtime.runs[0]?.body.threadId
      const second = runtime.runs[1]?.body.threadId

      expect(first).toBeTruthy()
      expect(second).toBeTruthy()
      expect(second).not.toBe(first)
      expect(runtime.runs[1]?.body.messages).toHaveLength(1)
      expect(runtime.runs[1]?.body.messages?.[0]).toMatchObject({ role: 'user', content: 'again' })
      expect(runtime.denied).toEqual([])
    })
  })

  describe('explicit threadId', () => {
    it('restores the kept conversation through /connect and continues it on the same thread', async () => {
      runtime = installRuntimeScenario({ ...scenarios.default, threads: [KEPT_THREAD] })

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} chat={{ threadId: RESTORED_THREAD_ID }} />)

      await expect.element(screen.getByText(KEPT_ANSWER)).toBeVisible()
      expect(connectedThreads(runtime)).toEqual([RESTORED_THREAD_ID])
      expect(screen.getByTestId(WELCOME_SCREEN).query()).toBeNull()
      expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()

      await send(screen, 'and in Chiang Mai?')
      await waitForRuns(runtime, 1)
      expect(runtime.runs[0]?.body.threadId).toBe(RESTORED_THREAD_ID)
      expect(
        runtime.runs[0]?.body.messages?.map((message) => {
          return message.content
        }),
      ).toEqual([KEPT_QUESTION, KEPT_ANSWER, 'and in Chiang Mai?'])
      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.denied).toEqual([])
    })

    // react-core 1.88 draws its own "Loading conversation" spinner while a kept chat connects; the
    // preset keeps the panel empty until the history lands, as every release before it did.
    it("never shows CopilotKit's connecting spinner while the kept conversation loads", async () => {
      runtime = installRuntimeScenario({ ...scenarios.default, threads: [KEPT_THREAD] })

      let spinners = 0

      const observer = new MutationObserver(() => {
        spinners += document.querySelectorAll(`[data-testid="${CONNECTING_INDICATOR}"]`).length
      })

      observer.observe(document.body, { childList: true, subtree: true })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} chat={{ ...NOMADREAM_PRESET.chat, threadId: RESTORED_THREAD_ID }} />,
      )

      await expect.element(screen.getByText(KEPT_ANSWER)).toBeVisible()
      observer.disconnect()

      expect(spinners).toBe(0)
    })

    it('opens an id the server does not keep on an empty chat without an error', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} chat={{ threadId: RESTORED_THREAD_ID }} />)

      await vi.waitFor(() => {
        expect(connectedThreads(runtime)).toEqual([RESTORED_THREAD_ID])
      })
      // A restored thread is never empty as far as the view knows, so the welcome screen is skipped.
      expect(screen.getByTestId(WELCOME_SCREEN).query()).toBeNull()
      expect(screen.getByTestId(USER_MESSAGE).query()).toBeNull()

      await send(screen, 'hello')
      await waitForRuns(runtime, 1)
      expect(runtime.runs[0]?.body.threadId).toBe(RESTORED_THREAD_ID)
      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(screen.getByTestId(ERROR_LINE).query()).toBeNull()
    })
  })

  describe('thread list', () => {
    // `/info` advertises `threadEndpoints.list: true` (as the Lambda does), so the hook asks.
    it('lists the kept conversations from GET /threads, and a picked one is restored', async () => {
      runtime = installRuntimeScenario({ ...scenarios.default, threads: [KEPT_THREAD] })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ThreadList />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('thread-row')).toHaveTextContent(KEPT_QUESTION)
      expect(runtime.requests).toContainEqual(expect.objectContaining({ method: 'GET', path: '/threads' }))
      expect(screen.getByTestId('threads-error').query()).toBeNull()

      await screen.getByTestId('thread-row').click()

      await expect.element(screen.getByText(KEPT_ANSWER)).toBeVisible()
      expect(connectedThreads(runtime)).toEqual([RESTORED_THREAD_ID])
    })
  })

  describe('self-managed persistence', () => {
    it('brings a finished conversation back after a remount, from the server alone', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const first = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await send(first, 'hello')
      await expect.element(first.getByText(REPLY)).toBeVisible()

      const threadId = runtime.runs[0]?.body.threadId ?? ''

      await first.unmount()

      const reopened = await mount(<AIChat {...NOMADREAM_PRESET} chat={{ threadId }} />)

      await expect.element(reopened.getByText(REPLY)).toBeVisible()
      await expect.element(reopened.getByTestId(USER_MESSAGE)).toHaveTextContent('hello')
      expect(connectedThreads(runtime)).toEqual([threadId])
    })
  })
})
