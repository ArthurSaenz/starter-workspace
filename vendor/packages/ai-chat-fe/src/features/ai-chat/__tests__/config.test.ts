import { describe, expect, it } from 'vitest'

import { SafeMarkdownRenderer } from '../components/safe-markdown-renderer.js'
import { AI_CHAT_TOKENS, NoDisclaimer, defineAiChat, resolveAiChat, themeCss } from '../services/main.js'
import type { AiChatPreset, AiChatProps } from '../types.js'
import { NOMADREAM_PRESET } from './helpers/index.js'

const BASE: AiChatProps = { runtimeUrl: '/rt', agentId: 'travelAiAgent' }

const Welcome = () => {
  return null
}

const Disclaimer = () => {
  return null
}

describe('resolveAiChat — agent binding and provider defaults', () => {
  it('writes the agent id on the provider, the chat and the configuration context', () => {
    const { provider, chat, configuration } = resolveAiChat(BASE)

    expect(provider.agentId).toBe('travelAiAgent')
    expect(chat.agentId).toBe('travelAiAgent')
    expect(configuration.agentId).toBe('travelAiAgent')
    expect(provider.runtimeUrl).toBe('/rt')
  })

  it('defaults credentials to same-origin and the inspector to off, and lets props override both', () => {
    expect(resolveAiChat(BASE).provider).toMatchObject({ credentials: 'same-origin', enableInspector: false })
    expect(
      resolveAiChat({ ...BASE, provider: { credentials: 'include', enableInspector: true } }).provider,
    ).toMatchObject({ credentials: 'include', enableInspector: true })
  })

  it('merges provider shallowly over the preset and an undefined key never erases', () => {
    const preset: AiChatPreset = { ...BASE, provider: { headers: { 'x-a': '1' }, debug: true } }
    const { provider } = resolveAiChat({ ...BASE, provider: { headers: { 'x-b': '2' }, debug: undefined } }, preset)

    expect(provider.headers).toEqual({ 'x-b': '2' })
    expect(provider.debug).toBe(true)
  })

  it('copies only the forwarded provider keys, even when a preset object carries the rest', () => {
    const smuggled = {
      agents__unsafe_dev_only: {},
      selfManagedAgents: {},
      publicApiKey: 'k',
      publicLicenseKey: 'k',
      licenseToken: 'k',
      showDevConsole: true,
      useSingleEndpoint: true,
      onError: () => {},
      children: null,
    }

    const preset = { ...BASE, provider: { headers: { a: '1' }, ...smuggled } } as unknown as AiChatPreset

    const { provider } = resolveAiChat({ ...BASE, provider: { ...smuggled } } as AiChatProps, preset)

    for (const key of Object.keys(smuggled)) expect(provider).not.toHaveProperty(key)
    expect(provider.headers).toEqual({ a: '1' })
  })

  it('forwards the streaming throttle; the preset sets one', () => {
    expect(resolveAiChat({ ...BASE, provider: { defaultThrottleMs: 10 } }).provider.defaultThrottleMs).toBe(10)
    expect(resolveAiChat(NOMADREAM_PRESET).provider.defaultThrottleMs).toBeGreaterThan(0)
  })

  // Generative UI the agent drives: both are forwarded as given; the preset sets only `a2ui`.
  it('forwards the a2ui and openGenerativeUI provider props', () => {
    const a2ui = { includeSchema: false }
    const openGenerativeUI = { designSkill: 'flat' }

    const { provider } = resolveAiChat({ ...BASE, provider: { a2ui, openGenerativeUI } })

    expect(provider.a2ui).toEqual(a2ui)
    expect(provider.openGenerativeUI).toEqual(openGenerativeUI)
    expect(resolveAiChat(NOMADREAM_PRESET).provider).not.toHaveProperty('openGenerativeUI')
    expect(resolveAiChat(NOMADREAM_PRESET).provider.a2ui).toEqual({ includeSchema: false })
  })

  it('never lets the reserved chat keys through, from props or preset', () => {
    const reserved = {
      onError: () => {},
      onSubmitMessage: () => {},
      agentId: 'other',
      isModalDefaultOpen: true,
      inspectorTools: [],
      chatView: () => {
        return null
      },
    }

    const preset = { ...BASE, chat: { ...reserved } } as unknown as AiChatPreset

    const { chat } = resolveAiChat({ ...BASE, chat: { ...reserved } } as unknown as AiChatProps, preset)

    expect(chat).not.toHaveProperty('onError')
    expect(chat).not.toHaveProperty('onSubmitMessage')
    expect(chat).not.toHaveProperty('isModalDefaultOpen')
    expect(chat).not.toHaveProperty('inspectorTools')
    expect(chat).not.toHaveProperty('chatView')
    expect(chat.agentId).toBe('travelAiAgent')
  })
})

describe('resolveAiChat — chat deep merge', () => {
  const preset: AiChatPreset = {
    ...BASE,
    chat: {
      labels: { welcomeMessageText: 'preset welcome', chatInputPlaceholder: 'preset placeholder' },
      input: { disclaimer: Disclaimer, autoFocus: true },
      className: 'preset-class',
    },
  }

  it('merges labels key by key over the preset', () => {
    const { chat, configuration } = resolveAiChat(
      { ...BASE, chat: { labels: { chatInputPlaceholder: 'mine' } } },
      preset,
    )

    expect(chat.labels).toEqual({ welcomeMessageText: 'preset welcome', chatInputPlaceholder: 'mine' })
    expect(configuration.labels).toEqual(chat.labels)
  })

  it('merges an object-form slot key by key: toolsMenu lands next to the preset disclaimer', () => {
    const toolsMenu = [{ label: 'x', action: () => {} }]
    const { chat } = resolveAiChat({ ...BASE, chat: { input: { toolsMenu } } }, preset)

    expect(chat.input).toEqual({ disclaimer: Disclaimer, autoFocus: true, toolsMenu })
  })

  it('a string slot replaces the object slot', () => {
    const { chat } = resolveAiChat({ ...BASE, chat: { input: 'only-a-class' } }, preset)

    expect(chat.input).toBe('only-a-class')
  })

  it('undefined keys never erase a preset value, at the top level and inside a slot', () => {
    const { chat } = resolveAiChat(
      {
        ...BASE,
        chat: { className: undefined, labels: { welcomeMessageText: undefined }, input: { autoFocus: undefined } },
      },
      preset,
    )

    expect(chat.className).toBe('preset-class')
    expect(chat.labels?.welcomeMessageText).toBe('preset welcome')
    expect(chat.input).toEqual({ disclaimer: Disclaimer, autoFocus: true })
  })

  it('copies threadId onto the configuration only when set', () => {
    expect(resolveAiChat(BASE).configuration).not.toHaveProperty('threadId')
    expect(resolveAiChat({ ...BASE, chat: { threadId: 't-1' } }).configuration.threadId).toBe('t-1')
  })
})

describe('resolveAiChat — features', () => {
  it('welcome: false turns the welcome screen off; a string re-words it; a component replaces it', () => {
    expect(resolveAiChat({ ...BASE, features: { welcome: false } }).chat.welcomeScreen).toBe(false)
    expect(resolveAiChat({ ...BASE, features: { welcome: 'Hello' } }).chat.labels?.welcomeMessageText).toBe('Hello')
    expect(resolveAiChat({ ...BASE, features: { welcome: Welcome } }).chat.welcomeScreen).toBe(Welcome)
  })

  it('disclaimer: false nulls the slot and keeps the consumer input keys next to it', () => {
    const { chat } = resolveAiChat({ ...BASE, chat: { input: { autoFocus: true } }, features: { disclaimer: false } })

    expect(chat.input).toEqual({ autoFocus: true, disclaimer: NoDisclaimer })
  })

  it('disclaimer: string re-words the label; a component fills the slot', () => {
    expect(resolveAiChat({ ...BASE, features: { disclaimer: 'Mind the gap' } }).chat.labels?.chatDisclaimerText).toBe(
      'Mind the gap',
    )
    expect(resolveAiChat({ ...BASE, features: { disclaimer: Disclaimer } }).chat.input).toEqual({
      disclaimer: Disclaimer,
    })
  })

  it('a props feature overrides the preset feature of the same key without touching the others', () => {
    const preset: AiChatPreset = { ...BASE, features: { disclaimer: false, welcome: false } }
    const { chat } = resolveAiChat({ ...BASE, features: { disclaimer: 'Careful' } }, preset)

    expect(chat.input).toEqual({})
    expect(chat.labels?.chatDisclaimerText).toBe('Careful')
    expect(chat.welcomeScreen).toBe(false)
  })

  it("a consumer's explicit chat slot beats the preset's feature switch; the consumer's features apply last", () => {
    const preset: AiChatPreset = { ...BASE, features: { disclaimer: false, welcome: false } }

    const explicit = resolveAiChat({ ...BASE, chat: { input: { disclaimer: Disclaimer } } }, preset)

    expect(explicit.chat.input).toEqual({ disclaimer: Disclaimer })

    const reworded = resolveAiChat({ ...BASE, features: { welcome: 'Hello' } }, preset)

    expect(reworded.chat.welcomeScreen).toBeUndefined()
    expect(reworded.chat.labels?.welcomeMessageText).toBe('Hello')

    const both = resolveAiChat({
      ...BASE,
      chat: { input: { disclaimer: Disclaimer } },
      features: { disclaimer: false },
    })

    expect(both.chat.input).toEqual({ disclaimer: NoDisclaimer })
  })

  it('suggestions become the hook config with consumerAgentId, in both forms', () => {
    const items = [{ title: 'A', message: 'a' }]

    expect(resolveAiChat({ ...BASE, features: { suggestions: items } }).suggestions).toEqual({
      suggestions: items,
      available: 'before-first-message',
      consumerAgentId: 'travelAiAgent',
    })
    expect(resolveAiChat({ ...BASE, features: { suggestions: { items, available: 'always' } } }).suggestions).toEqual({
      suggestions: items,
      available: 'always',
      consumerAgentId: 'travelAiAgent',
    })
    expect(resolveAiChat(BASE).suggestions).toBeNull()
  })

  it('feedback lands on messageView.assistantMessage', () => {
    const onThumbsUp = () => {}
    const { chat } = resolveAiChat({ ...BASE, features: { feedback: { onThumbsUp } } })

    expect(chat.messageView).toEqual({ assistantMessage: { onThumbsUp, markdownRenderer: SafeMarkdownRenderer } })
  })

  it('the assistant markdown is the hardened renderer unless a layer names its own', () => {
    const Plain = () => {
      return null
    }

    const WholeView = () => {
      return null
    }

    expect(resolveAiChat(BASE).chat.messageView).toEqual({
      assistantMessage: { markdownRenderer: SafeMarkdownRenderer },
    })
    expect(
      resolveAiChat({ ...BASE, chat: { messageView: { assistantMessage: { markdownRenderer: Plain } } } }).chat
        .messageView,
    ).toEqual({ assistantMessage: { markdownRenderer: Plain } })
    expect(resolveAiChat({ ...BASE, chat: { messageView: 'my-view' } }).chat.messageView).toEqual({
      className: 'my-view',
      assistantMessage: { markdownRenderer: SafeMarkdownRenderer },
    })
    expect(resolveAiChat({ ...BASE, chat: { messageView: WholeView } }).chat.messageView).toBe(WholeView)
  })

  it('errorLine resolves to default / custom / none / re-worded', () => {
    const Line = () => {
      return null
    }

    expect(resolveAiChat(BASE).errorLine).toEqual({})
    expect(resolveAiChat({ ...BASE, features: { errorLine: true } }).errorLine).toEqual({})
    expect(resolveAiChat({ ...BASE, features: { errorLine: false } }).errorLine).toBeNull()
    expect(resolveAiChat({ ...BASE, features: { errorLine: Line } }).errorLine).toEqual({ component: Line })
    expect(resolveAiChat({ ...BASE, features: { errorLine: { text: { offline: 'Down.' } } } }).errorLine).toEqual({
      text: { offline: 'Down.' },
    })
  })

  it('failureText words every line under errorLine.text, and is taken from the preset when the props leave it out', () => {
    const Line = () => {
      return null
    }

    const failureText = { offline: 'Acme is down.', unavailable: 'Acme is unavailable.' }

    expect(resolveAiChat({ ...BASE, failureText }).errorLine).toEqual({ text: failureText })
    expect(resolveAiChat({ ...BASE, failureText, features: { errorLine: Line } }).errorLine).toEqual({
      component: Line,
      text: failureText,
    })
    expect(
      resolveAiChat({ ...BASE, failureText, features: { errorLine: { text: { offline: 'Down.' } } } }).errorLine,
    ).toEqual({ text: { offline: 'Down.', unavailable: 'Acme is unavailable.' } })
    expect(resolveAiChat({ ...BASE, failureText, features: { errorLine: false } }).errorLine).toBeNull()
    expect(resolveAiChat(BASE, { ...BASE, failureText }).errorLine).toEqual({ text: failureText })
  })

  it('trustedHosts defaults to none and comes from the props, else the preset', () => {
    expect(resolveAiChat(BASE).trustedHosts).toEqual([])
    expect(resolveAiChat(BASE, { ...BASE, trustedHosts: ['acme.example'] }).trustedHosts).toEqual(['acme.example'])
    expect(
      resolveAiChat({ ...BASE, trustedHosts: ['own.example'] }, { ...BASE, trustedHosts: ['acme.example'] })
        .trustedHosts,
    ).toEqual(['own.example'])
  })

  it('surface defaults to inline and context to an empty list', () => {
    const resolved = resolveAiChat(BASE)

    expect(resolved.surface).toEqual({ kind: 'inline' })
    expect(resolved.context).toEqual([])
    expect(resolveAiChat({ ...BASE, surface: { kind: 'popup', defaultOpen: true } }).surface).toEqual({
      kind: 'popup',
      defaultOpen: true,
    })
  })
})

describe('themeCss', () => {
  it('scopes to the instance by default and emits only the set keys', () => {
    expect(themeCss('r1', { tokens: { background: 'red', radius: '0' } })).toBe(
      '[data-ai-chat="r1"] [data-copilotkit]{--background:red;--radius:0}',
    )
  })

  it('doubles the attribute for host scope', () => {
    expect(themeCss('r1', { tokens: { primary: 'blue' }, scope: 'host' })).toBe(
      '[data-copilotkit][data-copilotkit]{--primary:blue}',
    )
  })

  it('emits nothing without a set token', () => {
    expect(themeCss('r1', undefined)).toBeUndefined()
    expect(themeCss('r1', { dark: true })).toBeUndefined()
    expect(themeCss('r1', { tokens: { background: undefined } })).toBeUndefined()
  })

  it('is what resolveAiChat returns, with preset tokens merged under the props tokens', () => {
    const preset: AiChatPreset = { ...BASE, theme: { tokens: { background: 'white', foreground: 'black' } } }
    const { themeCss: css } = resolveAiChat({ ...BASE, theme: { tokens: { foreground: 'grey' } } }, preset, 'x')

    expect(css).toBe('[data-ai-chat="x"] [data-copilotkit]{--background:white;--foreground:grey}')
  })

  it('names the 33 tokens CopilotKit declares on [data-copilotkit]', () => {
    expect(AI_CHAT_TOKENS).toHaveLength(33)
    expect(new Set(AI_CHAT_TOKENS).size).toBe(33)
  })
})

describe('nOMADREAM_PRESET', () => {
  it('is the client /chat surface: agent, cookie auth, no disclaimer, three pills', () => {
    const resolved = resolveAiChat(NOMADREAM_PRESET)

    expect(resolved.provider).toMatchObject({
      runtimeUrl: '/api/v1/ai/copilotkit',
      agentId: 'travelAiAgent',
      credentials: 'same-origin',
      enableInspector: false,
    })
    expect(resolved.chat.input).toEqual({ disclaimer: NoDisclaimer })
    expect(resolved.chat.labels?.chatDisclaimerText).toBeUndefined()
    expect(resolved.chat.labels?.chatInputPlaceholder).toBe('Ask anything…')
    expect(resolved.suggestions?.suggestions).toHaveLength(3)
  })

  it('defineAiChat is the identity', () => {
    expect(defineAiChat(BASE)).toBe(BASE)
  })
})
