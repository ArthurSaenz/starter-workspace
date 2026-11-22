import type {
  AgentContextInput,
  CopilotChatConfigurationProviderProps,
  CopilotChatProps,
} from '@copilotkit/react-core/v2'
import type { FC } from 'react'

import { SafeMarkdownRenderer } from '../components/safe-markdown-renderer.js'
import type {
  AiChatChatProps,
  AiChatDynamicSuggestionsConfig,
  AiChatFeatures,
  AiChatPreset,
  AiChatProps,
  AiChatProviderProps,
  AiChatSuggestionsConfig,
  AiChatSurface,
  AiChatTheme,
  ChatFailureLineProps,
  ChatFailureText,
} from '../types.js'
import { themeCss } from './theme.js'

/** Identity with inference: keeps a preset literal fully typed so `preset.chat.labels` stays navigable. */
export const defineAiChat = <TProps extends AiChatProps>(props: TProps): TProps => {
  return props
}

export interface ResolvedAiChat {
  provider: AiChatProviderProps & { runtimeUrl: string; agentId: string }
  chat: AiChatChatProps & { agentId: string }
  configuration: Omit<CopilotChatConfigurationProviderProps, 'children'>
  surface: AiChatSurface
  /** `null` when no pills are configured; otherwise the `useConfigureSuggestions` argument. */
  suggestions: AiChatSuggestionsConfig | null
  /** `null` unless `features.dynamicSuggestions` is set; a second `useConfigureSuggestions` argument. */
  dynamicSuggestions: AiChatDynamicSuggestionsConfig | null
  context: readonly AgentContextInput[]
  /** `null` renders nothing; an absent `component` means the package's own line. */
  errorLine: { component?: FC<ChatFailureLineProps>; text?: ChatFailureText } | null
  /** What the chat's markdown links treat as the consumer's own hosts (`TrustedHostsContext`). */
  trustedHosts: readonly string[]
  themeCss: string | undefined
}

/**
 * Turns the declarative props (and an optional preset underneath them) into what the CopilotKit
 * primitives take. Merge rule: `chat.labels` and every object-form slot on `chat` (`input`,
 * `messageView`, `suggestionView`, `scrollView`, `welcomeScreen`) merge key by key over the
 * preset; a string or component replaces the slot; `undefined` keys are dropped first and never
 * erase a preset value. `provider`, `features` and `theme` merge shallowly under the same rule
 * (`theme.tokens` key by key). Layering: each layer's `features` are applied to that layer's
 * `chat` before the next layer merges over it, so a consumer's `chat.input.disclaimer` beats the
 * preset's `features.disclaimer: false`, and the consumer's own `features` are applied last.
 * The assistant's markdown goes through `SafeMarkdownRenderer` unless a layer names its own renderer.
 * `failureText` and `trustedHosts` come from the props, else the preset.
 * `agentId` is written on the provider, the chat and the configuration context; `credentials`
 * defaults to `same-origin`, `enableInspector` to `false`. `id` is the wrapper's `data-ai-chat`
 * value the theme CSS is scoped to.
 */
export const resolveAiChat = (props: AiChatProps, preset?: AiChatPreset, id = 'ai-chat'): ResolvedAiChat => {
  const { runtimeUrl, agentId } = props
  const features = { ...withoutUndefined(preset?.features), ...withoutUndefined(props.features) }
  const theme = mergeTheme(preset?.theme, props.theme)

  const presetChat = applyFeatures(mergeChatProps(undefined, preset?.chat), preset?.features ?? {})
  const chat = withSafeMarkdown(applyFeatures(mergeChatProps(presetChat, props.chat), props.features ?? {}))
  const provider = pickProviderProps({ ...withoutUndefined(preset?.provider), ...withoutUndefined(props.provider) })

  return {
    provider: {
      ...provider,
      runtimeUrl,
      agentId,
      credentials: provider.credentials ?? 'same-origin',
      enableInspector: provider.enableInspector ?? false,
    },
    chat: { ...chat, agentId },
    configuration: {
      agentId,
      labels: chat.labels ?? {},
      ...(chat.threadId === undefined ? {} : { threadId: chat.threadId }),
    },
    surface: props.surface ?? preset?.surface ?? { kind: 'inline' },
    suggestions: resolveSuggestions(features.suggestions, agentId),
    dynamicSuggestions: resolveDynamicSuggestions(features.dynamicSuggestions, agentId),
    context: props.context ?? [],
    errorLine: resolveErrorLine(features.errorLine, props.failureText ?? preset?.failureText),
    trustedHosts: props.trustedHosts ?? preset?.trustedHosts ?? [],
    themeCss: themeCss(id, theme),
  }
}

// A slot value can also be a component or a string, in which case the override replaces the
// whole slot. Keys set to `undefined` are dropped first: without `exactOptionalPropertyTypes`,
// a consumer's `{ className: undefined }` would otherwise erase the default.
export const mergeChatProps = (
  defaults: Partial<CopilotChatProps> | undefined,
  overrides: Partial<CopilotChatProps> | undefined,
): AiChatChatProps => {
  const base = stripReserved(withoutUndefined(defaults))
  const defined = stripReserved(withoutUndefined(overrides))
  const merged: Record<string, unknown> = { ...base, ...defined }

  if (base.labels || defined.labels) merged.labels = { ...base.labels, ...withoutUndefined(defined.labels) }

  for (const slot of CHAT_OBJECT_SLOTS) {
    const defaultSlot = base[slot]
    const overrideSlot = defined[slot]

    if (isPlainObject(defaultSlot) && isPlainObject(overrideSlot)) {
      merged[slot] = { ...defaultSlot, ...withoutUndefined(overrideSlot) }
    }
  }

  return merged as AiChatChatProps
}

// CopilotChatView hard-codes `showDisclaimer: true`, so an empty label would still render
// CopilotKit's own "AI can make mistakes" line; a null slot is the only way to drop it.
export const NoDisclaimer = () => {
  return null
}

const applyFeatures = (chat: AiChatChatProps, features: AiChatFeatures): AiChatChatProps => {
  const { welcome, disclaimer, feedback } = features
  const next: AiChatChatProps = { ...chat }

  // A string re-words the copy and also undoes the package's own "off" from a lower layer (the
  // `false` sentinel), never a consumer's explicit slot value.
  if (welcome === false) next.welcomeScreen = false
  else if (typeof welcome === 'string') {
    next.labels = { ...next.labels, welcomeMessageText: welcome }
    if (next.welcomeScreen === false) delete next.welcomeScreen
  } else if (welcome) next.welcomeScreen = welcome

  if (disclaimer === false) next.input = withSlotProps(next.input, { disclaimer: NoDisclaimer })
  else if (typeof disclaimer === 'string') {
    next.labels = { ...next.labels, chatDisclaimerText: disclaimer }
    if (isPlainObject(next.input) && next.input.disclaimer === NoDisclaimer) {
      next.input = withoutSlotProp(next.input, 'disclaimer')
    }
  } else if (disclaimer) next.input = withSlotProps(next.input, { disclaimer })

  if (feedback) {
    const assistantMessage = isPlainObject(next.messageView) ? next.messageView.assistantMessage : undefined

    next.messageView = withSlotProps(next.messageView, {
      assistantMessage: withSlotProps(assistantMessage, withoutUndefined(feedback)),
    })
  }

  return next
}

// A component-form `messageView` or `assistantMessage` is the consumer's whole view, renderer included.
const withSafeMarkdown = (chat: AiChatChatProps): AiChatChatProps => {
  const { messageView } = chat

  if (typeof messageView === 'function') return chat

  const assistantMessage = isPlainObject(messageView) ? messageView.assistantMessage : undefined

  if (typeof assistantMessage === 'function') return chat
  if (isPlainObject(assistantMessage) && assistantMessage.markdownRenderer !== undefined) return chat

  return {
    ...chat,
    messageView: withSlotProps(messageView, {
      assistantMessage: withSlotProps(assistantMessage, { markdownRenderer: SafeMarkdownRenderer }),
    }),
  }
}

// A component-form slot is the consumer's whole replacement, so a feature cannot reach into it and
// leaves it alone; a string-form slot is its class name, which survives as `className`.
const withSlotProps = <TSlot>(slot: TSlot | undefined, props: Record<string, unknown>): TSlot => {
  if (typeof slot === 'function') return slot
  if (typeof slot === 'string') return { className: slot, ...props } as TSlot

  return { ...slot, ...props } as TSlot
}

const withoutSlotProp = <TSlot>(slot: TSlot & Record<string, unknown>, key: string): TSlot => {
  const rest: Record<string, unknown> = { ...slot }

  delete rest[key]

  return rest as TSlot
}

const resolveSuggestions = (
  suggestions: AiChatFeatures['suggestions'],
  agentId: string,
): AiChatSuggestionsConfig | null => {
  if (!suggestions) return null

  const items = Array.isArray(suggestions) ? suggestions : suggestions.items
  const available = Array.isArray(suggestions) ? undefined : suggestions.available

  // `consumerAgentId` is set even though the configuration context now carries the agent id: the
  // hook reads the context, not the provider, and the explicit id keeps the pills bound when a
  // consumer renders the registrar outside the chat's configuration (FINDING-1).
  return { suggestions: items, available: available ?? 'before-first-message', consumerAgentId: agentId }
}

// `providerAgentId` too: the engine's default is the literal id `default`, which only resolves
// while the runtime happens to register the agent under that alias as well.
const resolveDynamicSuggestions = (
  dynamicSuggestions: AiChatFeatures['dynamicSuggestions'],
  agentId: string,
): AiChatDynamicSuggestionsConfig | null => {
  if (!dynamicSuggestions) return null

  return {
    ...dynamicSuggestions,
    available: dynamicSuggestions.available ?? 'after-first-message',
    providerAgentId: agentId,
    consumerAgentId: agentId,
  }
}

const resolveErrorLine = (
  errorLine: AiChatFeatures['errorLine'],
  failureText: ChatFailureText | undefined,
): ResolvedAiChat['errorLine'] => {
  if (errorLine === false) return null

  const component = typeof errorLine === 'function' ? errorLine : undefined
  const lineText = typeof errorLine === 'object' ? errorLine.text : undefined
  const text = failureText || lineText ? { ...failureText, ...lineText } : undefined

  return { ...(component ? { component } : {}), ...(text ? { text } : {}) }
}

const mergeTheme = (base: AiChatTheme | undefined, override: AiChatTheme | undefined): AiChatTheme | undefined => {
  if (!base && !override) return undefined

  const merged: AiChatTheme = { ...withoutUndefined(base), ...withoutUndefined(override) }

  if (base?.tokens || override?.tokens) {
    merged.tokens = { ...withoutUndefined(base?.tokens), ...withoutUndefined(override?.tokens) }
  }

  return merged
}

// The exhaustive form on purpose: a key added to `AiChatProviderProps` without a row here fails
// to compile, and a key a preset object smuggles in at runtime (`publicApiKey`, …) never passes.
const PROVIDER_KEYS: Record<keyof AiChatProviderProps, true> = {
  headers: true,
  credentials: true,
  properties: true,
  debug: true,
  frontendTools: true,
  humanInTheLoop: true,
  renderToolCalls: true,
  renderCustomMessages: true,
  renderActivityMessages: true,
  enableInspector: true,
  a2ui: true,
  // Passing it at all switches the feature on in the browser, whatever `/info` says; no preset does.
  openGenerativeUI: true,
  defaultThrottleMs: true,
}

const pickProviderProps = (source: Record<string, unknown>): AiChatProviderProps => {
  const picked: Record<string, unknown> = {}

  for (const key of Object.keys(PROVIDER_KEYS)) {
    if (key in source) picked[key] = source[key]
  }

  return picked as AiChatProviderProps
}

// The agent binding and the error channel are the package's, the modal-owner flag belongs to the
// launcher surfaces (`surface.defaultOpen`), the inspector shortcuts are dev-only and the view is always
// CopilotKit's; a preset object typed loosely at the call site must not be able to reach `CopilotChat`
// with any of them.
const stripReserved = (chat: Partial<CopilotChatProps>): AiChatChatProps => {
  const rest: Partial<CopilotChatProps> = { ...chat }

  for (const key of RESERVED_CHAT_KEYS) delete rest[key]

  return rest
}

const RESERVED_CHAT_KEYS = [
  'agentId',
  'onError',
  'onSubmitMessage',
  'isModalDefaultOpen',
  'inspectorTools',
  'chatView',
] as const

const CHAT_OBJECT_SLOTS = ['input', 'messageView', 'suggestionView', 'scrollView', 'welcomeScreen'] as const

const withoutUndefined = <TObject extends object>(value: TObject | undefined): Partial<TObject> => {
  if (!value) return {}

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      return entry !== undefined
    }),
  ) as Partial<TObject>
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
