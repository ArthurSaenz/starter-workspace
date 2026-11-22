import type { CopilotChatAssistantMessage } from '@copilotkit/react-core/v2'
import type { ComponentProps, ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { Locator } from 'vitest/browser'

import { SeedTranscript } from '../__stories__/kit/seed-transcript.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { LONG_EXCHANGE, SHORT_EXCHANGE, exchange } from '../__stories__/kit/transcripts.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../types.js'
import {
  FAKE_THREAD_ID,
  NOMADREAM_PRESET,
  REASONING_TEXT,
  REPLY,
  installRuntimeScenario,
  scenarios,
  thinkingFrames,
} from './helpers/index.js'
import type { FakeRuntime, RuntimeScenario } from './helpers/index.js'

// The Messages area: what its stories show, asserted. The stories open on a seeded conversation or a
// turn under way; these click the toolbar buttons and check what reaches the handlers and the wire.
// Already covered elsewhere: the default markdown reply, the default loading cursor and the empty
// reply (ai-chat-states.test.tsx), the traveller context on the wire (ai-chat-container.test.tsx).

type Screen = Awaited<ReturnType<typeof render>>
type MessageView = NonNullable<NonNullable<AiChatProps['chat']>['messageView']>
type PlainTextProps = ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>

const USER_MESSAGE = 'copilot-user-message'
const ASSISTANT_MESSAGE = 'copilot-assistant-message'
const ASSISTANT_TOOLBAR = 'copilot-assistant-toolbar'
const COPY_BUTTON = 'copilot-copy-button'
const USER_COPY_BUTTON = 'copilot-user-copy-button'
const CURSOR = 'copilot-loading-cursor'
const SEND_BUTTON = 'copilot-send-button'

// Each renders only when its handler is set.
const HANDLER_GATED_BUTTONS = [
  'copilot-thumbs-up-button',
  'copilot-thumbs-down-button',
  'copilot-read-aloud-button',
  'copilot-regenerate-button',
  'copilot-edit-button',
]

// `toHaveTextContent` matches the whole text here; a chip or a bubble also carries other text.
const expectTextToContain = async (locator: Locator, text: string) => {
  await vi.waitFor(() => {
    expect(locator.element().textContent).toContain(text)
  })
}

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

const seeded = (messageView?: MessageView, transcript = SHORT_EXCHANGE) => {
  return mount(
    <AIChat {...NOMADREAM_PRESET} chat={{ ...NOMADREAM_PRESET.chat, messageView }}>
      <SeedTranscript messages={transcript} />
    </AIChat>,
  )
}

// The user toolbar is `invisible` until the bubble is hovered, which a real pointer cannot trigger
// reliably here; the click goes to the button directly, as the hovering traveller's would.
const clickHidden = (screen: Screen, testId: string) => {
  ;(screen.getByTestId(testId).element() as HTMLElement).click()
}

const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('messages', () => {
  let runtime: FakeRuntime

  const install = (scenario: RuntimeScenario = scenarios.default) => {
    runtime = installRuntimeScenario(scenario)
  }

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('copy', () => {
    it('both bubbles copy their text; the default toolbar has nothing else', async () => {
      install()
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      const screen = await seeded()
      const assistantCopy = screen.getByTestId(ASSISTANT_MESSAGE).getByTestId(COPY_BUTTON)

      await expect.element(assistantCopy).toBeVisible()
      for (const testId of HANDLER_GATED_BUTTONS) expect(screen.getByTestId(testId).query()).toBeNull()

      await assistantCopy.click()

      expect(writeText).toHaveBeenCalledWith(REPLY)
      await vi.waitFor(() => {
        expect(assistantCopy.element().querySelector('svg.lucide-check')).not.toBeNull()
      })

      clickHidden(screen, USER_COPY_BUTTON)

      expect(writeText).toHaveBeenLastCalledWith('hello')
      expect(writeText).toHaveBeenCalledTimes(2)
    })

    it('copyButton slots that render nothing drop both buttons and keep the toolbar', async () => {
      install()

      const NoCopyButton = () => {
        return null
      }

      const screen = await seeded({
        assistantMessage: { copyButton: NoCopyButton },
        userMessage: { copyButton: NoCopyButton },
      })

      // The toolbar is what separates this from `toolbarVisible: false`; awaited first so the null
      // checks below are not vacuous on an unrendered transcript.
      await expect.element(screen.getByTestId(ASSISTANT_MESSAGE).getByTestId(ASSISTANT_TOOLBAR)).toBeInTheDocument()
      expect(screen.getByTestId(COPY_BUTTON).query()).toBeNull()
      expect(screen.getByTestId(USER_COPY_BUTTON).query()).toBeNull()
    })
  })

  describe('message slots', () => {
    it('additionalToolbarItems sit in the assistant toolbar after the copy button', async () => {
      install()
      const onSave = vi.fn()

      const screen = await seeded({
        assistantMessage: {
          additionalToolbarItems: (
            <button type="button" onClick={onSave}>
              Save to trip
            </button>
          ),
        },
      })

      const toolbar = screen.getByTestId(ASSISTANT_MESSAGE).getByTestId(ASSISTANT_TOOLBAR)

      await expect.element(toolbar.getByRole('button', { name: 'Save to trip' })).toBeVisible()
      expect(toolbar.getByTestId(COPY_BUTTON).query()).not.toBeNull()

      await toolbar.getByRole('button', { name: 'Save to trip' }).click()

      expect(onSave).toHaveBeenCalledTimes(1)
      expect(runtime.runs).toHaveLength(0)
    })

    it('toolbarVisible: false removes the assistant toolbar, the user bubble keeps its own', async () => {
      install()

      const screen = await seeded({ assistantMessage: { toolbarVisible: false } })

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByTestId(USER_COPY_BUTTON)).toBeInTheDocument()
      expect(screen.getByTestId(ASSISTANT_TOOLBAR).query()).toBeNull()
      expect(screen.getByTestId(COPY_BUTTON).query()).toBeNull()
    })
  })

  describe('handler buttons', () => {
    const replyMessage = expect.objectContaining({ role: 'assistant', content: REPLY })

    it('thumbs up and down each call their handler with the reply, and post nothing', async () => {
      install()
      const onThumbsUp = vi.fn()
      const onThumbsDown = vi.fn()

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          features={{ ...NOMADREAM_PRESET.features, feedback: { onThumbsUp, onThumbsDown } }}
        >
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      const assistant = screen.getByTestId(ASSISTANT_MESSAGE)

      await assistant.getByTestId('copilot-thumbs-up-button').click()

      expect(onThumbsUp).toHaveBeenCalledTimes(1)
      expect(onThumbsUp).toHaveBeenCalledWith(replyMessage)
      expect(onThumbsDown).not.toHaveBeenCalled()

      await assistant.getByTestId('copilot-thumbs-down-button').click()

      expect(onThumbsDown).toHaveBeenCalledTimes(1)
      expect(onThumbsDown).toHaveBeenCalledWith(replyMessage)
      expect(runtime.runs).toHaveLength(0)
    })

    it('read aloud calls onReadAloud with the reply', async () => {
      install()
      const onReadAloud = vi.fn()

      const screen = await seeded({ assistantMessage: { onReadAloud } })

      await screen.getByTestId(ASSISTANT_MESSAGE).getByTestId('copilot-read-aloud-button').click()

      expect(onReadAloud).toHaveBeenCalledTimes(1)
      expect(onReadAloud).toHaveBeenCalledWith(replyMessage)
    })

    it('regenerate calls onRegenerate with the reply and does not re-run the turn', async () => {
      install()
      const onRegenerate = vi.fn()

      const screen = await seeded({ assistantMessage: { onRegenerate } })

      await screen.getByTestId(ASSISTANT_MESSAGE).getByTestId('copilot-regenerate-button').click()

      expect(onRegenerate).toHaveBeenCalledTimes(1)
      expect(onRegenerate).toHaveBeenCalledWith(replyMessage)

      // Long enough for a re-run to have been posted if the click triggered one.
      await sleep(300)
      expect(runtime.runs).toHaveLength(0)
      await expect.element(screen.getByText(REPLY)).toBeVisible()
    })

    it('edit calls onEditMessage with the user message; branch navigation never renders', async () => {
      install()
      const onEditMessage = vi.fn()
      const onSwitchToBranch = vi.fn()

      const screen = await seeded({ userMessage: { onEditMessage, onSwitchToBranch } })
      const user = screen.getByTestId(USER_MESSAGE)

      await expect.element(user.getByTestId('copilot-edit-button')).toBeInTheDocument()
      // 1.90.0: CopilotChatMessageView passes no `numberOfBranches`, so the arrows never mount.
      expect(user.getByTestId('copilot-branch-navigation').query()).toBeNull()

      clickHidden(screen, 'copilot-edit-button')

      expect(onEditMessage).toHaveBeenCalledTimes(1)
      expect(onEditMessage).toHaveBeenCalledWith({
        message: expect.objectContaining({ role: 'user', content: 'hello' }),
      })
      expect(onSwitchToBranch).not.toHaveBeenCalled()
      expect(runtime.runs).toHaveLength(0)
    })
  })

  describe('custom markdown renderer', () => {
    it('draws the reply through the slot instead of Streamdown', async () => {
      install()

      const PlainText = (props: PlainTextProps) => {
        return <pre data-testid="plain-text">{props.content}</pre>
      }

      const screen = await seeded({ assistantMessage: { markdownRenderer: PlainText } }, LONG_EXCHANGE)
      const plain = screen.getByTestId(ASSISTANT_MESSAGE).getByTestId('plain-text')

      await expectTextToContain(plain, '# Three weeks in Bangkok — the honest total')
      await expectTextToContain(plain, '| Line item | Per night | 21 nights |')
      expect(screen.getByRole('heading').query()).toBeNull()
      expect(screen.getByRole('table').query()).toBeNull()
      expect(screen.container.querySelector('pre code')).toBeNull()
    })
  })

  describe('hardened markdown', () => {
    it('never renders an image and keeps a link only for https or mailto', async () => {
      install()

      const reply = [
        'Your plan is ready ![](https://evil.example/x?d=1) and here ![x](data:image/png;base64,iVBORw0KGgo=).',
        '<img src="https://evil.example/raw?d=2">',
        '[Park Hyatt](https://www.hyatt.com/park-hyatt) · [mail us](mailto:hi@nomadream.ai) · [trap](http://evil.example/t)',
      ].join('\n\n')

      const screen = await seeded(undefined, exchange('plan', reply))
      const message = screen.getByTestId(ASSISTANT_MESSAGE)

      await expectTextToContain(message, 'Your plan is ready')
      await expectTextToContain(message, 'trap')

      expect(message.element().querySelector('img, source, picture')).toBeNull()
      expect(screen.container.querySelector('[src*="evil.example"]')).toBeNull()
      expect(
        performance.getEntriesByType('resource').filter((entry) => {
          return entry.name.includes('evil.example')
        }),
      ).toEqual([])

      const hrefs = [...message.element().querySelectorAll('a')].map((link) => {
        return link.getAttribute('href')
      })

      expect(hrefs).toEqual(['https://www.hyatt.com/park-hyatt', 'mailto:hi@nomadream.ai'])

      for (const link of message.element().querySelectorAll('a')) {
        expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
        expect(link.getAttribute('target')).toBe('_blank')
      }
    })

    it("keeps a link to the consumer's trustedHosts whole and cuts the same link to its origin without them", async () => {
      install()

      const reply = 'Open [your chat](https://nomadream.ai/share?id=abc) again.'

      const linkOf = async (trustedHosts?: readonly string[]) => {
        const screen = await mount(
          <AIChat {...NOMADREAM_PRESET} trustedHosts={trustedHosts}>
            <SeedTranscript messages={exchange('link', reply)} />
          </AIChat>,
        )

        const link = screen.getByRole('link', { name: 'your chat' })

        await expect.element(link).toBeVisible()

        const result = {
          href: link.element().getAttribute('href'),
          labelled: screen.container.querySelector('[data-streamdown="link-host"]') !== null,
        }

        await screen.unmount()

        return result
      }

      expect(await linkOf(['nomadream.ai'])).toEqual({ href: 'https://nomadream.ai/share?id=abc', labelled: false })
      expect(await linkOf()).toEqual({ href: 'https://nomadream.ai/', labelled: true })
    })
  })

  describe('loading cursor', () => {
    it('a custom cursor replaces the pulsing dot while the run is open', async () => {
      install(scenarios.thinking)

      const RatesCursor = () => {
        return <p role="status">Checking the rates…</p>
      }

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} chat={{ ...NOMADREAM_PRESET.chat, messageView: { cursor: RatesCursor } }}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByText('Checking the rates…')).toBeVisible()
      expect(screen.getByTestId(CURSOR).query()).toBeNull()
      expect(screen.getByTestId(SEND_BUTTON).element().querySelector('svg.lucide-square')).not.toBeNull()
      expect(runtime.runs).toHaveLength(1)
    })
  })

  // The Lambda emits these only with LANGGRAPH_THINKING_BUDGET ≠ 0; the frames mirror InProcessAgent's.
  describe('reasoning frames', () => {
    it('show "Thinking…" while the thought streams, then a block above the reply', async () => {
      install({
        run: {
          kind: 'paced',
          batches: thinkingFrames(FAKE_THREAD_ID, REASONING_TEXT, REPLY).map((frame) => {
            return [frame]
          }),
          gapMs: 300,
        },
      })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByRole('button', { name: 'Thinking…' })).toBeVisible()
      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByRole('button', { name: /^Thought for / })).toBeVisible()

      const reasoning = screen.container.querySelector('[data-message-id="m1-reasoning"]')
      const assistant = screen.getByTestId(ASSISTANT_MESSAGE).element()

      if (!reasoning) throw new Error('no reasoning message with the `<chunkId>-reasoning` id')

      expect(reasoning.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('render a collapsed "Thought for" block that toggles open and shut', async () => {
      install(scenarios.reasoningMessage)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()

      const header = screen.getByRole('button', { name: /^Thought for / })

      // Collapsed is a `grid-template-rows: 0fr` row around an `overflow: hidden` wrapper, so the
      // wrapper's height is what shows; the text node keeps its own box either way.
      const reasoningHeight = () => {
        const clip = screen.getByText(REASONING_TEXT).element().closest('[class*="overflow-hidden"]')

        if (!clip) throw new Error('reasoning text is not inside the Toggle wrapper')

        return clip.getBoundingClientRect().height
      }

      await expect.element(header).toHaveAttribute('aria-expanded', 'false')
      await vi.waitFor(() => {
        expect(reasoningHeight()).toBe(0)
      })

      await header.click()

      await expect.element(header).toHaveAttribute('aria-expanded', 'true')
      await vi.waitFor(() => {
        expect(reasoningHeight()).toBeGreaterThan(0)
      })

      await header.click()

      await expect.element(header).toHaveAttribute('aria-expanded', 'false')
      await vi.waitFor(() => {
        expect(reasoningHeight()).toBe(0)
      })
    })
  })
})
