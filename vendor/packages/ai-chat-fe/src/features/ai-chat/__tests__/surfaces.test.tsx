import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { SeedTranscript } from '../__stories__/kit/seed-transcript.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { SHORT_EXCHANGE } from '../__stories__/kit/transcripts.js'
import { AIChatContainer } from '../containers/ai-chat-container.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { NOMADREAM_PRESET, REPLY, installRuntimeScenario, scenarios } from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// The Surfaces and copy area: what its stories show, asserted. The stories open on a state; these
// drive the transitions between states and check the wire.

type Screen = Awaited<ReturnType<typeof render>>

const TOGGLE = 'copilot-chat-toggle'
const SIDEBAR = 'copilot-sidebar'
const POPUP = 'copilot-popup'
const WELCOME_SCREEN = 'copilot-welcome-screen'
const PRESET_WELCOME = NOMADREAM_PRESET.chat.labels.welcomeMessageText
const LAST_HEADING = 'Bottom line'

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement, height = 600) => {
  return render(<div style={{ height }}>{element}</div>)
}

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

// The transcript's scroll container is whichever ancestor of `copilot-scroll-content` actually clips —
// a different element per `autoScroll` mode, and the pinned modes also carry an `overflow-y-auto` div
// that never clips, so overflow alone is not enough.
const scrollContainerOf = (root: HTMLElement): HTMLElement => {
  let element = root.querySelector('[data-testid="copilot-scroll-content"]')?.parentElement ?? null

  while (element && element !== root) {
    const overflowY = getComputedStyle(element).overflowY

    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) return element
    element = element.parentElement
  }

  throw new Error('No clipping scroll ancestor of copilot-scroll-content — did the reply overflow?')
}

interface WelcomeProps {
  input: ReactElement
  suggestionView: ReactElement
}

const distanceFromBottom = (element: HTMLElement): number => {
  return element.scrollHeight - element.scrollTop - element.clientHeight
}

describe('surfaces and copy', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('inline chat', () => {
    it('renders in place without launcher chrome and runs the configured agent', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expect.element(screen.getByTestId('copilot-chat')).toBeVisible()
      expect(screen.getByTestId(TOGGLE).query()).toBeNull()
      expect(screen.getByTestId(SIDEBAR).query()).toBeNull()
      expect(screen.getByTestId(POPUP).query()).toBeNull()

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.requests[0]).toMatchObject({ method: 'GET', path: '/info' })
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.url).toMatch(/\/agent\/travelAiAgent\/run$/)
    })

    it('keeps to the height the host gives it, a long reply scrolling inside', async () => {
      runtime = installRuntimeScenario(scenarios.markdownReply)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />, 320)
      const wrapper = screen.getByTestId('ai-chat').element()

      await expect.element(screen.getByRole('textbox')).toBeVisible()
      expect(wrapper.getBoundingClientRect().height).toBe(320)

      await send(screen, 'three weeks in Bangkok')

      await expect.element(screen.getByRole('heading', { level: 2, name: LAST_HEADING })).toBeInTheDocument()
      expect(wrapper.getBoundingClientRect().height).toBe(320)
      expect(screen.getByTestId('copilot-chat').element().getBoundingClientRect().height).toBeLessThanOrEqual(320)
    })

    it('opens on a seeded transcript (the stories’ conversation states)', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect.element(screen.getByTestId('copilot-user-message')).toHaveTextContent('hello')
      expect(screen.getByTestId(WELCOME_SCREEN).query()).toBeNull()
      expect(runtime.runs).toHaveLength(0)
    })
    it('opens on a turn already sent (the stories’ in-progress states)', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="hello" />
        </AIChat>,
      )

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    })
  })

  describe('sidebar', () => {
    it('starts closed with defaultOpen: false and the toggle flips it both ways', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} surface={{ kind: 'sidebar', defaultOpen: false }} />)

      await expect.element(screen.getByTestId(TOGGLE)).toHaveAttribute('data-state', 'closed')
      await expect.element(screen.getByTestId(TOGGLE)).toHaveAttribute('aria-label', 'Open chat')
      await expect.element(screen.getByTestId(SIDEBAR)).toHaveAttribute('aria-hidden', 'true')

      await screen.getByTestId(TOGGLE).click()

      await expect.element(screen.getByTestId(SIDEBAR)).toHaveAttribute('aria-hidden', 'false')
      await expect.element(screen.getByTestId(TOGGLE)).toHaveAttribute('aria-label', 'Close chat')
      await expect.element(screen.getByRole('textbox')).toBeVisible()

      // The open panel covers the toggle in the narrow test iframe; the click goes to it directly.
      ;(screen.getByTestId(TOGGLE).element() as HTMLElement).click()

      await expect.element(screen.getByTestId(SIDEBAR)).toHaveAttribute('aria-hidden', 'true')
    })

    it('opens docked left, titled by the label, chats inside and closes from the header', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          surface={{ kind: 'sidebar', defaultOpen: true, position: 'left' }}
          chat={{ labels: { ...NOMADREAM_PRESET.chat.labels, modalHeaderTitle: 'NomaDream assistant' } }}
        />,
      )

      await expect.element(screen.getByTestId(SIDEBAR)).toHaveAttribute('aria-hidden', 'false')
      await expect.element(screen.getByTestId(SIDEBAR)).toHaveAttribute('data-position', 'left')
      await expect.element(screen.getByTestId('copilot-header-title')).toHaveTextContent('NomaDream assistant')

      await send(screen, 'hello')

      await expect.element(screen.getByTestId(SIDEBAR).getByText(REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)

      await screen.getByTestId('copilot-close-button').click()

      await expect.element(screen.getByTestId(SIDEBAR)).toHaveAttribute('aria-hidden', 'true')
      await expect.element(screen.getByTestId(TOGGLE)).toHaveAttribute('data-state', 'closed')
    })
  })

  describe('popup', () => {
    it('starts closed with defaultOpen: false; the toggle opens it and the close button removes it', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} surface={{ kind: 'popup', defaultOpen: false }} />)

      await expect.element(screen.getByTestId(TOGGLE)).toHaveAttribute('data-state', 'closed')
      expect(screen.getByTestId(POPUP).query()).toBeNull()

      await screen.getByTestId(TOGGLE).click()

      await expect.element(screen.getByRole('dialog')).toBeVisible()
      await expect.element(screen.getByRole('textbox')).toBeVisible()

      await screen.getByTestId('copilot-close-button').click()

      await vi.waitFor(() => {
        expect(screen.getByTestId(POPUP).query()).toBeNull()
      })
      await expect.element(screen.getByTestId(TOGGLE)).toHaveAttribute('data-state', 'closed')
    })

    it('closes on a click outside with clickOutsideToClose, not on one inside', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <>
          <button type="button">outside</button>
          <AIChat {...NOMADREAM_PRESET} surface={{ kind: 'popup', defaultOpen: true, clickOutsideToClose: true }} />
        </>,
      )

      await expect.element(screen.getByRole('dialog')).toBeVisible()

      await screen.getByRole('textbox').click()

      await expect.element(screen.getByTestId(POPUP)).toBeVisible()

      // The popup covers the test iframe, so a real pointer cannot reach anything outside it; the
      // popup listens for `pointerdown` on the document, which is what a click outside sends.
      screen
        .getByRole('button', { name: 'outside' })
        .element()
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

      await vi.waitFor(() => {
        expect(screen.getByTestId(POPUP).query()).toBeNull()
      })
      expect(runtime.runs).toHaveLength(0)
    })
  })

  describe('headless hooks in children', () => {
    // No agent id anywhere: the children resolve the configured agent through AIChat's provider.
    const AskFromOutside = () => {
      const { agent } = useAgent()
      const { copilotkit } = useCopilotKit()

      const ask = () => {
        agent.addMessage({ id: 'outside-1', role: 'user', content: 'hello' })
        void copilotkit.runAgent({ agent })
      }

      return (
        <button type="button" data-agent-id={agent.agentId} onClick={ask}>
          Ask from outside
        </button>
      )
    }

    it('drive the configured agent: a run started from a child lands in the chat', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <AskFromOutside />
        </AIChat>,
      )

      const button = screen.getByRole('button', { name: 'Ask from outside' })

      await expect.element(button).toHaveAttribute('data-agent-id', 'travelAiAgent')
      await expect.element(screen.getByRole('textbox')).toBeVisible()

      await button.click()

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.url).toMatch(/\/agent\/travelAiAgent\/run$/)
    })
  })

  describe('labels', () => {
    it('merge key by key: one override leaves the preset greeting', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChatContainer
          preset={NOMADREAM_PRESET}
          userName="Ada"
          chat={{ labels: { chatInputPlaceholder: 'Where to next, Ada?' } }}
        />,
      )

      await expect.element(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Where to next, Ada?')
      await expect.element(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PRESET_WELCOME)
      expect(screen.getByText('How can I help you today?').query()).toBeNull()
    })

    it('land on their own elements, including the message toolbars', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      // Each key its own sentinel, so a label on the wrong element shows.
      const sentinel = {
        chatInputPlaceholder: '«chatInputPlaceholder»',
        welcomeMessageText: '«welcomeMessageText»',
        assistantMessageToolbarCopyMessageLabel: '«assistantMessageToolbarCopyMessageLabel»',
        userMessageToolbarCopyMessageLabel: '«userMessageToolbarCopyMessageLabel»',
      }

      const screen = await mount(
        <AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" chat={{ labels: sentinel }} />,
      )

      await expect.element(screen.getByRole('textbox')).toHaveAttribute('placeholder', sentinel.chatInputPlaceholder)
      await expect.element(screen.getByRole('heading', { level: 1 })).toHaveTextContent(sentinel.welcomeMessageText)

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      await expect
        .element(screen.getByTestId('copilot-user-message').getByTestId('copilot-user-copy-button'))
        .toHaveAttribute('aria-label', sentinel.userMessageToolbarCopyMessageLabel)
      await expect
        .element(screen.getByTestId('copilot-assistant-message').getByTestId('copilot-copy-button'))
        .toHaveAttribute('aria-label', sentinel.assistantMessageToolbarCopyMessageLabel)
      expect(screen.getByLabelText('Copy', { exact: true }).query()).toBeNull()
    })
  })

  describe('welcome screen', () => {
    it('shows the preset greeting on an empty thread and goes away after the first message', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expect
        .element(screen.getByTestId(WELCOME_SCREEN).getByRole('heading', { level: 1 }))
        .toHaveTextContent(PRESET_WELCOME)
      await vi.waitFor(() => {
        expect(screen.getByTestId(WELCOME_SCREEN).getByTestId('copilot-suggestion').elements()).toHaveLength(3)
      })

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(screen.getByTestId(WELCOME_SCREEN).query()).toBeNull()
    })

    it('is gone with features.welcome: false, the input and pills kept', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} features={{ ...NOMADREAM_PRESET.features, welcome: false }} />,
      )

      await expect.element(screen.getByRole('textbox')).toBeVisible()
      await vi.waitFor(() => {
        expect(screen.getByTestId('copilot-suggestion').elements()).toHaveLength(3)
      })
      expect(screen.getByTestId(WELCOME_SCREEN).query()).toBeNull()
      expect(screen.getByText(PRESET_WELCOME).query()).toBeNull()
    })

    it('is replaced by a component that places the input and pills itself', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const Welcome = (props: WelcomeProps) => {
        return (
          <div data-testid="custom-welcome">
            {props.input}
            {props.suggestionView}
          </div>
        )
      }

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} features={{ ...NOMADREAM_PRESET.features, welcome: Welcome }} />,
      )

      const welcome = screen.getByTestId('custom-welcome')

      await expect.element(welcome.getByRole('textbox')).toBeVisible()
      await vi.waitFor(() => {
        expect(welcome.getByTestId('copilot-suggestion').elements()).toHaveLength(3)
      })
      expect(screen.getByTestId(WELCOME_SCREEN).query()).toBeNull()

      await send(screen, 'hello')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(welcome.query()).toBeNull()
    })
  })

  describe('disclaimer', () => {
    it('a string on features.disclaimer turns the preset’s false back into that line', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const text = 'Numbers are estimates — check them before you book.'

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} features={{ ...NOMADREAM_PRESET.features, disclaimer: text }} />,
      )

      await expect.element(screen.getByText(text)).toBeVisible()
      expect(screen.getByText('AI can make mistakes. Please verify important information.').query()).toBeNull()
    })
  })

  describe('auto-scroll', () => {
    it('pins a long reply to the bottom by default', async () => {
      runtime = installRuntimeScenario(scenarios.markdownReply)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await send(screen, 'three weeks in Bangkok')

      await expect.element(screen.getByRole('heading', { level: 2, name: LAST_HEADING })).toBeInTheDocument()
      const container = scrollContainerOf(screen.container)

      // StickToBottom animates the catch-up scroll; give it the frames it needs.
      await vi.waitFor(
        () => {
          expect(distanceFromBottom(container)).toBeLessThanOrEqual(2)
        },
        { timeout: 4000 },
      )
      expect(container.scrollTop).toBeGreaterThan(0)
    })

    it('leaves the scroll alone with autoScroll: "none"', async () => {
      runtime = installRuntimeScenario(scenarios.markdownReply)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} chat={{ ...NOMADREAM_PRESET.chat, autoScroll: 'none' }} />,
      )

      await send(screen, 'three weeks in Bangkok')

      await expect.element(screen.getByRole('heading', { level: 2, name: LAST_HEADING })).toBeInTheDocument()
      const container = scrollContainerOf(screen.container)

      // Long enough for any deferred catch-up scroll to have fired if one existed.
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })
      expect(container.scrollTop).toBe(0)
      expect(distanceFromBottom(container)).toBeGreaterThan(2)
    })
  })
})
