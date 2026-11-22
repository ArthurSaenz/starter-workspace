import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { WireLog } from '../__stories__/kit/runtime.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { NOMADREAM_PRESET, REPLY, SUGGESTION_REPLY, installRuntimeScenario, scenarios } from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// The Runtime and auth area: what its stories configure, checked on the wire.

const RUN_PATH = `${NOMADREAM_PRESET.runtimeUrl}/agent/${NOMADREAM_PRESET.agentId}/run`
// Lower-case: the fake records what `new Headers()` normalises, which is what the Lambda reads too.
const TRACE_HEADER = 'x-story-trace'
const TRACE_VALUE = 'ada-42'
const WORDS = ['Bangkok ', 'for ', 'three ', 'weeks: ', 'plan ', 'on ', 'the ', 'long-stay ', 'rate.']
const GAP_MS = 150

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

type Screen = Awaited<ReturnType<typeof mount>>

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

const pathOf = (url: string | undefined): string => {
  return new URL(url ?? '', window.location.origin).pathname
}

const sendAndWaitForReply = async (screen: Screen) => {
  await send(screen, 'hello')
  await expect.element(screen.getByText(REPLY)).toBeVisible()
}

describe('runtime and auth', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('agent id', () => {
    it('both ways a turn starts — a pill and the composer — post to the configured agent', async () => {
      runtime = installRuntimeScenario(scenarios.suggestionClick)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await screen.getByText('Plan a long stay').click()
      await expect.element(screen.getByText(SUGGESTION_REPLY)).toBeVisible()

      await send(screen, 'and the second question')
      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(2)
      })
      expect(pathOf(runtime.runs[0]?.url)).toBe(RUN_PATH)
      expect(pathOf(runtime.runs[1]?.url)).toBe(RUN_PATH)
    })
  })

  describe('cookies', () => {
    it('every request, the handshake included, goes out with credentials: same-origin', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await sendAndWaitForReply(screen)

      expect(
        runtime.requests.map((request) => {
          return request.path
        }),
      ).toContain('/info')
      for (const request of runtime.requests) expect(request.credentials, request.path).toBe('same-origin')
    })
  })

  describe('headers', () => {
    it('carry no custom header with nothing configured; the run is JSON', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await sendAndWaitForReply(screen)

      expect(runtime.requests.length).toBeGreaterThanOrEqual(2)
      for (const request of runtime.requests) expect(request.headers, request.path).not.toHaveProperty(TRACE_HEADER)

      const run = runtime.requests.find((request) => {
        return request.path.endsWith('/run')
      })

      expect(run?.headers['content-type']).toBe('application/json')
    })

    it('provider.headers reach the handshake and the run', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ headers: { [TRACE_HEADER]: TRACE_VALUE } }} />,
      )

      await sendAndWaitForReply(screen)

      expect(
        runtime.requests.map((request) => {
          return request.path
        }),
      ).toContain('/info')
      for (const request of runtime.requests) expect(request.headers[TRACE_HEADER], request.path).toBe(TRACE_VALUE)
    })
  })

  describe('runtime handshake', () => {
    // The 401 handshake is ai-chat-states.test.tsx's "a 401 /info is swallowed by the auto transport".
    it('fires GET /info before anything is typed and, answered, lets a turn through', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await vi.waitFor(() => {
        expect(runtime.requests[0]).toMatchObject({ method: 'GET', path: '/info' })
      })
      await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
      await expect.element(screen.getByRole('textbox')).toBeEnabled()
      expect(runtime.runs).toHaveLength(0)
      expect(screen.getByTestId('ai-chat-error').query()).toBeNull()
      // The default /info is the Lambda without GEMINI_API_KEY: no transcription service, so no mic.
      expect(screen.getByTestId('copilot-start-transcribe-button').query()).toBeNull()

      await sendAndWaitForReply(screen)

      expect(runtime.runs).toHaveLength(1)
      expect(screen.getByTestId('ai-chat-error').query()).toBeNull()
    })
  })

  describe('streaming replies', () => {
    it('renders the first words while the rest are still on the wire', async () => {
      runtime = installRuntimeScenario({ run: { kind: 'streamed', words: WORDS, gapMs: GAP_MS } })

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await send(screen, 'Plan Bangkok')

      await vi.waitFor(() => {
        const bubble = screen.getByTestId('copilot-assistant-message').element()

        expect(bubble).toHaveTextContent('Bangkok for')
        expect(bubble).not.toHaveTextContent('long-stay rate.')
      })
      await vi.waitFor(
        () => {
          expect(screen.getByTestId('copilot-assistant-message').element()).toHaveTextContent(WORDS.join('').trim())
        },
        { timeout: WORDS.length * GAP_MS + 3000 },
      )
      expect(runtime.runs).toHaveLength(1)
    })
  })

  describe('the stories’ wire log', () => {
    it('lists each request under the runtime URL with its credentials and the chosen header', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ headers: { [TRACE_HEADER]: TRACE_VALUE } }}>
          <WireLog runtime={runtime} runtimeUrl={NOMADREAM_PRESET.runtimeUrl} header={TRACE_HEADER} />
          <StartRun message="hello" />
        </AIChat>,
      )

      const entries = screen.getByTestId('wire-log').getByRole('listitem')
      const suffix = ` · credentials: same-origin · ${TRACE_HEADER}: ${TRACE_VALUE}`

      await expect.element(entries.nth(1)).toHaveTextContent(`POST ${RUN_PATH}${suffix}`)
      await expect.element(entries.nth(0)).toHaveTextContent(`GET ${NOMADREAM_PRESET.runtimeUrl}/info${suffix}`)
    })
  })
})
