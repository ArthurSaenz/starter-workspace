import type { CopilotChatSuggestionPill } from '@copilotkit/react-core/v2'
import { useSuggestions } from '@copilotkit/react-core/v2'
import type { ComponentProps, ReactElement } from 'react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import type { AiChatSuggestionAvailability } from '../types.js'
import {
  DEFAULT_GENERATED_SUGGESTIONS,
  NOMADREAM_PRESET,
  REPLY,
  SUGGESTION_REPLY,
  installRuntimeScenario,
  scenarios,
} from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// The Suggestions area: what its stories show, asserted. The shipped container's boot and pill click
// are ai-chat-states.test.tsx's ("renders the three suggestions…", "(FINDING-1)", "a clicked
// suggestion is sent as the user message").

type Screen = Awaited<ReturnType<typeof render>>
type StoryPillProps = ComponentProps<typeof CopilotChatSuggestionPill>

const PILL = 'copilot-suggestion'
const PILLS = NOMADREAM_PRESET.features.suggestions
const [LONG_STAY, ...OTHER_PILLS] = PILLS

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

const expectPills = async (screen: Screen, count: number) => {
  await vi.waitFor(() => {
    expect(screen.getByTestId(PILL).elements()).toHaveLength(count)
  })
}

const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const withAvailability = (available: AiChatSuggestionAvailability) => {
  return { ...NOMADREAM_PRESET.features, suggestions: { items: PILLS, available } }
}

describe('suggestions', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('availability', () => {
    it("'always' shows the pills on the empty thread and again under the reply, without /suggest", async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} features={withAvailability('always')} />)

      await expectPills(screen, 3)

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expectPills(screen, 3)
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.suggests).toHaveLength(0)
      expect(runtime.denied).toEqual([])
    })

    it("'after-first-message' shows none on the empty thread and the three under the reply", async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} features={withAvailability('after-first-message')} />)

      await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
      expect(screen.getByTestId(PILL).elements()).toHaveLength(0)

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expectPills(screen, 3)
      expect(runtime.denied).toEqual([])
    })

    it("'disabled' never shows a pill and adds no request", async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} features={withAvailability('disabled')} />)

      await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
      expect(screen.getByTestId(PILL).elements()).toHaveLength(0)

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(screen.getByTestId(PILL).elements()).toHaveLength(0)
      expect(
        runtime.requests.map((request) => {
          return request.path
        }),
      ).toEqual(['/info', '/agent/travelAiAgent/run'])
    })
  })

  describe('agent-generated pills', () => {
    it('replace the static pills after the first answer, and a click sends the generated message', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          features={{
            ...NOMADREAM_PRESET.features,
            dynamicSuggestions: { instructions: 'Suggest what a long-stay traveller in Bangkok could ask next.' },
          }}
        />,
      )

      await expectPills(screen, 3)
      expect(runtime.suggests).toHaveLength(0)

      await send(screen, 'hello')

      await vi.waitFor(() => {
        expect(runtime.suggests).toHaveLength(1)
      })
      expect(runtime.suggests[0]?.url).toContain('/agent/travelAiAgent/suggest')
      expect(runtime.suggests[0]?.body.forwardedProps).toMatchObject({
        toolChoice: { function: { name: 'copilotkitSuggest' } },
      })

      await expectPills(screen, DEFAULT_GENERATED_SUGGESTIONS.length)
      await expect.element(screen.getByTestId(PILL).first()).toHaveTextContent(DEFAULT_GENERATED_SUGGESTIONS[0]!.title)

      await screen.getByTestId(PILL).nth(1).click()

      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(2)
      })
      expect(runtime.runs[1]?.body.messages?.at(-1)).toMatchObject({
        role: 'user',
        content: DEFAULT_GENERATED_SUGGESTIONS[1]!.message,
      })
      expect(screen.getByTestId('ai-chat-error').query()).toBeNull()
      expect(runtime.denied).toEqual([])
    })
  })

  describe('programmatic suggestions', () => {
    // Mounted through `children`, as a consumer would: no agent id, the configuration context resolves it.
    const Controls = () => {
      const { suggestions, isLoading, reloadSuggestions, clearSuggestions } = useSuggestions()

      return (
        <div>
          <output data-testid="pill-count">{suggestions.length}</output>
          <output data-testid="pill-loading">{String(isLoading)}</output>
          <button type="button" onClick={clearSuggestions}>
            Clear pills
          </button>
          <button type="button" onClick={reloadSuggestions}>
            Reload pills
          </button>
        </div>
      )
    }

    it('useSuggestions() reads the chat’s pills; clear and reload are local — no request', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <Controls />
        </AIChat>,
      )

      await expectPills(screen, 3)
      await expect.element(screen.getByTestId('pill-count')).toHaveTextContent('3')
      const requestsBefore = runtime.requests.length

      await screen.getByRole('button', { name: 'Clear pills' }).click()

      await expectPills(screen, 0)
      await expect.element(screen.getByTestId('pill-count')).toHaveTextContent('0')

      await screen.getByRole('button', { name: 'Reload pills' }).click()

      await expectPills(screen, 3)
      await expect.element(screen.getByTestId('pill-count')).toHaveTextContent('3')
      await expect.element(screen.getByTestId('pill-loading')).toHaveTextContent('false')
      expect(runtime.requests).toHaveLength(requestsBefore)
      expect(runtime.denied).toEqual([])
      expect(runtime.runs).toHaveLength(0)
    })

    it('a clear as soon as the pills register stays cleared (the Cleared story’s opening state)', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const ClearOnOpen = () => {
        const { suggestions, clearSuggestions } = useSuggestions()
        const clearedRef = useRef(false)

        useEffect(() => {
          if (clearedRef.current || suggestions.length === 0) return

          clearedRef.current = true
          clearSuggestions()
        }, [clearSuggestions, suggestions.length])

        return <output data-testid="pill-count">{suggestions.length}</output>
      }

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ClearOnOpen />
        </AIChat>,
      )

      await expect.element(screen.getByText(/NomaDream assistant/)).toBeVisible()
      // Long enough for any late re-registration of the static config to have landed.
      await sleep(500)
      expect(screen.getByTestId(PILL).elements()).toHaveLength(0)
      await expect.element(screen.getByTestId('pill-count')).toHaveTextContent('0')
    })
  })

  describe('pill rendering', () => {
    // CopilotKit's pills container is `pointer-events: none`; a replacement pill must opt back in.
    const StoryPill = (props: StoryPillProps) => {
      return (
        <button
          type="button"
          data-testid="story-pill"
          className={props.className}
          style={{ pointerEvents: 'auto' }}
          onClick={props.onClick}
        >
          ★ {props.children}
        </button>
      )
    }

    it('a suggestionView pill replaces CopilotKit’s, gets the per-item className and still sends', async () => {
      runtime = installRuntimeScenario(scenarios.suggestionClick)

      if (!LONG_STAY) throw new Error('The preset has no suggestion pills')

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          chat={{ ...NOMADREAM_PRESET.chat, suggestionView: { suggestion: StoryPill } }}
          features={{
            ...NOMADREAM_PRESET.features,
            suggestions: [{ ...LONG_STAY, className: 'font-bold' }, ...OTHER_PILLS],
          }}
        />,
      )

      await vi.waitFor(() => {
        expect(screen.getByTestId('story-pill').elements()).toHaveLength(3)
      })
      expect(screen.getByTestId(PILL).elements()).toHaveLength(0)
      await expect.element(screen.getByTestId('story-pill').first()).toHaveTextContent(`★ ${LONG_STAY.title}`)
      expect(screen.getByTestId('story-pill').first().element()).toHaveClass('font-bold')
      expect(screen.getByTestId('story-pill').nth(1).element()).not.toHaveClass('font-bold')

      await screen.getByRole('button', { name: `★ ${LONG_STAY.title}` }).click()

      await expect.element(screen.getByText(SUGGESTION_REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('copilot-user-message')).toHaveTextContent(LONG_STAY.message)
      expect(screen.getByTestId('story-pill').elements()).toHaveLength(0)
      expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: LONG_STAY.message })
    })
  })
})
