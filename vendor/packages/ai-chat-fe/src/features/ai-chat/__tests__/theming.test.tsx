import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { SeedTranscript } from '../__stories__/kit/seed-transcript.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { HostDarkClass, OpenToolsMenu } from '../__stories__/kit/theming.js'
import { SHORT_EXCHANGE } from '../__stories__/kit/transcripts.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { NOMADREAM_PRESET, installRuntimeScenario, scenarios } from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// The Theming and styling area: what its stories show, asserted through computed styles. Tailwind and
// both stylesheets reach this runner through `.storybook/preview.tsx` (vitest.setup.ts).

// Chromium keeps oklch in computed styles: CopilotKit's light `--background`/`--popover` read back
// as `oklch(1 0 0)`, the `.dark [data-copilotkit]` ones as `oklch(0.145 0 0)` / `oklch(0.985 0 0)`.
const LIGHT_SURFACE = 'oklch(1 0 0)'
const DARK_SURFACE = 'oklch(0.145 0 0)'
const DARK_FOREGROUND = 'oklch(0.985 0 0)'
const WHITE = 'rgb(255, 255, 255)'
// `rgb()` literals so the computed value is byte-equal to the token set.
const BRAND_BACKGROUND = 'rgb(255, 244, 214)'
const BRAND_FOREGROUND = 'rgb(64, 32, 0)'
const BRAND_POPOVER = 'rgb(214, 236, 255)'
// Tailwind's `red-700`.
const RED_700 = 'oklch(0.505 0.213 27.518)'

const PILL = 'copilot-suggestion'
const DROPDOWN = '[data-slot="dropdown-menu-content"]'
const TOOLS_MENU = [{ label: 'Attach itinerary', action: () => {} }]
const UNAVAILABLE_TEXT = 'The assistant is unavailable right now. Please try again.'

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

type Screen = Awaited<ReturnType<typeof mount>>

const styleOf = (element: Element) => {
  return getComputedStyle(element)
}

const firstPill = async (screen: Screen): Promise<HTMLElement> => {
  await vi.waitFor(() => {
    expect(screen.getByTestId(PILL).elements().length).toBeGreaterThan(0)
  })

  return screen.getByTestId(PILL).first().element() as HTMLElement
}

// Radix renders the menu in a portal at `<body>`, never inside the render container.
const openedMenu = async (): Promise<HTMLElement> => {
  return vi.waitFor(() => {
    const menu = document.querySelector<HTMLElement>(DROPDOWN)

    expect(menu).not.toBeNull()

    return menu as HTMLElement
  })
}

const injectedCss = (screen: Screen): string => {
  return screen.container.querySelector('[data-ai-chat] style')?.textContent ?? ''
}

describe('theming and styling', () => {
  let runtime: FakeRuntime

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('class overrides', () => {
    it('leave the message list with CopilotKit’s classes only when nothing is configured', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      const list = screen.getByTestId('copilot-message-list')

      await expect.element(list).toHaveClass('copilotKitMessages')
      expect(list.element()).not.toHaveClass('pt-10')
      expect(styleOf(list.element()).paddingTop).toBe('0px')
    })

    it('merge a slot string into the element’s classes and the host generates it', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} chat={{ messageView: 'pt-10' }}>
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      const list = screen.getByTestId('copilot-message-list')

      await expect.element(list).toHaveClass('pt-10')
      expect(list.element()).toHaveClass('copilotKitMessages')
      expect(styleOf(list.element()).paddingTop).toBe('40px')
    })
  })

  describe('copilotKit stylesheet', () => {
    it('declares its tokens on the chat root and rounds the pills', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)
      const pill = await firstPill(screen)
      const chat = screen.getByTestId('copilot-chat').element()

      expect(chat).toHaveAttribute('data-copilotkit')
      expect(styleOf(chat).getPropertyValue('--background').trim()).toBe('oklch(100% 0 0)')
      // `cpk:rounded-full` is `calc(infinity * 1px)`, which Chromium clamps.
      expect(styleOf(pill).borderTopLeftRadius).toBe('3.35544e+07px')
    })
  })

  describe('dark mode', () => {
    it('re-skins the pills and flips the enabled send button to white', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} theme={{ dark: true }} />)
      const pill = await firstPill(screen)

      expect(screen.getByTestId('ai-chat').element()).toHaveClass('dark')
      expect(styleOf(pill).backgroundColor).toBe(DARK_SURFACE)
      expect(styleOf(pill).color).toBe(DARK_FOREGROUND)

      // Enabled first: disabled it is `cpk:dark:disabled:bg-[#454545]`, and `cpk:transition-colors`
      // settles the computed value a beat after the state flip.
      await screen.getByRole('textbox').fill('x')
      await vi.waitFor(() => {
        const button = screen.getByTestId('copilot-send-button').element()

        expect(button).toBeEnabled()
        expect(styleOf(button).backgroundColor).toBe(WHITE)
      })
    })

    it('stops at the portalled tools menu until the host puts .dark on <html>', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const scoped = await mount(
        <AIChat {...NOMADREAM_PRESET} theme={{ dark: true }} chat={{ input: { toolsMenu: TOOLS_MENU } }}>
          <SeedTranscript messages={SHORT_EXCHANGE} />
          <OpenToolsMenu />
        </AIChat>,
      )

      const scopedMenu = await openedMenu()

      expect(styleOf(scoped.getByTestId('copilot-chat').element()).backgroundColor).toBe(DARK_SURFACE)
      expect(scoped.container.contains(scopedMenu)).toBe(false)
      expect(styleOf(scopedMenu).backgroundColor).toBe(LIGHT_SURFACE)

      await userEvent.keyboard('{Escape}')
      await vi.waitFor(() => {
        expect(document.querySelector(DROPDOWN)).toBeNull()
      })
      await scoped.unmount()

      const hosted = await mount(
        <AIChat {...NOMADREAM_PRESET} theme={{ dark: true }} chat={{ input: { toolsMenu: TOOLS_MENU } }}>
          <HostDarkClass />
          <SeedTranscript messages={SHORT_EXCHANGE} />
          <OpenToolsMenu />
        </AIChat>,
      )

      const hostedMenu = await openedMenu()

      expect(document.documentElement).toHaveClass('dark')
      expect(styleOf(hostedMenu).backgroundColor).toBe(DARK_SURFACE)

      await hosted.unmount()

      expect(document.documentElement).not.toHaveClass('dark')
    })
  })

  describe('design tokens', () => {
    it('re-colour what reads them, through a rule with only the set keys', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          theme={{ tokens: { background: BRAND_BACKGROUND, foreground: BRAND_FOREGROUND } }}
        >
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      const pill = await firstPill(screen)

      expect(styleOf(pill).backgroundColor).toBe(BRAND_BACKGROUND)
      expect(styleOf(pill).color).toBe(BRAND_FOREGROUND)
      expect(styleOf(screen.getByTestId('copilot-chat').element()).backgroundColor).toBe(BRAND_BACKGROUND)

      const css = injectedCss(screen)

      expect(css).toMatch(/^\[data-ai-chat="[^"]+"\] \[data-copilotkit\]\{/)
      expect(css).toContain(`--foreground:${BRAND_FOREGROUND}`)
      expect(css).not.toContain('--primary')
    })

    it('stop at the portalled tools menu with the default chat scope', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          theme={{ tokens: { background: BRAND_BACKGROUND, popover: BRAND_POPOVER } }}
          chat={{ input: { toolsMenu: TOOLS_MENU } }}
        >
          <SeedTranscript messages={SHORT_EXCHANGE} />
          <OpenToolsMenu />
        </AIChat>,
      )

      const menu = await openedMenu()

      expect(styleOf(screen.getByTestId('copilot-chat').element()).backgroundColor).toBe(BRAND_BACKGROUND)
      expect(screen.container.contains(menu)).toBe(false)
      expect(styleOf(menu).backgroundColor).toBe(LIGHT_SURFACE)
    })

    it('reach the portalled tools menu with scope: host', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          theme={{ tokens: { background: BRAND_BACKGROUND, popover: BRAND_POPOVER }, scope: 'host' }}
          chat={{ input: { toolsMenu: TOOLS_MENU } }}
        >
          <SeedTranscript messages={SHORT_EXCHANGE} />
          <OpenToolsMenu />
        </AIChat>,
      )

      const menu = await openedMenu()

      expect(injectedCss(screen)).toMatch(/^\[data-copilotkit\]\[data-copilotkit\]\{/)
      expect(styleOf(screen.getByTestId('copilot-chat').element()).backgroundColor).toBe(BRAND_BACKGROUND)
      expect(styleOf(menu).backgroundColor).toBe(BRAND_POPOVER)
    })
  })

  describe('structural chrome', () => {
    // display/flex-direction/min-height are ai-chat-root-container.test.tsx's; this is the fill.
    it('grows the chat root to the frame the host gives the wrapper', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expect.element(screen.getByTestId('copilot-chat')).toBeVisible()

      const wrapper = screen.getByTestId('ai-chat').element()

      expect(styleOf(screen.getByTestId('copilot-chat').element()).flexGrow).toBe('1')
      expect(wrapper.getBoundingClientRect().height).toBe(600)
    })
  })

  describe('tailwind utilities', () => {
    it('style the package’s error line with the host-generated classes', async () => {
      runtime = installRuntimeScenario(scenarios.http500)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="hello" />
        </AIChat>,
      )

      const line = screen.getByTestId('ai-chat-error')

      await expect.element(line).toHaveTextContent(UNAVAILABLE_TEXT)
      expect(line.element()).toHaveClass('text-red-700')
      expect(styleOf(line.element()).color).toBe(RED_700)
      expect(styleOf(line.element()).textAlign).toBe('center')
      expect(styleOf(line.element()).paddingLeft).toBe('16px')
      expect(styleOf(line.element()).paddingTop).toBe('8px')
    })
  })

  describe('host class hook', () => {
    it('bounds the wrapper from outside and the chat shrinks with it', async () => {
      runtime = installRuntimeScenario(scenarios.default)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} className="max-h-80 border-4 border-dashed">
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('copilot-chat')).toBeVisible()

      const wrapper = screen.getByTestId('ai-chat').element()
      const chat = screen.getByTestId('copilot-chat').element()

      expect(wrapper).toHaveClass('max-h-80', 'border-4', 'border-dashed')
      expect(styleOf(wrapper).maxHeight).toBe('320px')
      expect(wrapper.getBoundingClientRect().height).toBe(320)
      expect(chat.getBoundingClientRect().bottom).toBeLessThanOrEqual(wrapper.getBoundingClientRect().bottom)
    })
  })
})
