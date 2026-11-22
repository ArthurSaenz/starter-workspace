import type {
  AgentContextInput,
  CopilotChatFeedbackMessage,
  CopilotChatProps,
  CopilotKitProviderProps,
  CopilotPopupProps,
  CopilotSidebarProps,
  useConfigureSuggestions,
} from '@copilotkit/react-core/v2'
import type { FC, ReactNode } from 'react'

import type { AI_CHAT_TOKENS } from './services/theme.js'

export interface ChatFailureEvent {
  code: string
  error: Error
}

export type ChatFailureKind =
  | 'session-expired'
  | 'throttled'
  | 'quota-exceeded'
  | 'quota-unavailable'
  | 'budget-exhausted'
  | 'service-unavailable'
  | 'thread-running'
  | 'transcription-failed'
  | 'too-long'
  | 'not-kept'
  | 'conversation-changed'
  | 'run-error'
  | 'unavailable'
  | 'offline'

export interface ChatFailure {
  kind: ChatFailureKind
  text: string
}

/** Per-kind replacement copy for the traveller error line; an absent kind keeps the default. */
export type ChatFailureText = Partial<Record<ChatFailureKind, string>>

export interface ChatFailureLineProps {
  failure: ChatFailure
}

export type AiChatToken = (typeof AI_CHAT_TOKENS)[number]

export interface AiChatTheme {
  /** Written as `--<token>: <value>` on the chat's `[data-copilotkit]` roots; only the set keys are emitted. */
  tokens?: Partial<Record<AiChatToken, string>>
  /** Adds `.dark` to the wrapper; CopilotKit's portals (tooltips, menus) need `.dark` on the host's `<html>`. */
  dark?: boolean
  /**
   * `chat` (default) scopes the tokens to this instance; `host` writes them on every
   * `[data-copilotkit]` root in the document, which is the only way to reach the portalled parts.
   */
  scope?: 'chat' | 'host'
}

// `Suggestion` and the static suggestion config are `@copilotkit/core` types, which is not a
// dependency of this package: both are read off the hook's own signature instead.
type SuggestionsConfigInput = NonNullable<Parameters<typeof useConfigureSuggestions>[0]>
export type AiChatSuggestionsConfig = Extract<SuggestionsConfigInput, { suggestions: unknown }>
export type AiChatSuggestion = AiChatSuggestionsConfig['suggestions'][number]
export type AiChatSuggestionAvailability = NonNullable<AiChatSuggestionsConfig['available']>
export type AiChatDynamicSuggestionsConfig = Extract<SuggestionsConfigInput, { instructions: unknown }>

/** The `WelcomeScreenProps` slot type is not exported by CopilotKit; this is the slot's own prop type. */
export type WelcomeScreenComponent = Extract<NonNullable<CopilotChatProps['welcomeScreen']>, FC<never>>

export interface AiChatFeatures {
  /** `false` drops the empty-state screen; a string re-words it; a component replaces it. */
  welcome?: false | string | WelcomeScreenComponent
  /** `false` nulls the line under the composer (CopilotKit always renders one otherwise); a string re-words it. */
  disclaimer?: false | string | FC
  suggestions?: AiChatSuggestion[] | { items: AiChatSuggestion[]; available?: AiChatSuggestionAvailability }
  /**
   * Follow-up pills the agent writes after each answer (`POST agent/:id/suggest`, one extra model
   * call per turn). `available` defaults to `after-first-message`, so they take over from the
   * static pills once the conversation starts.
   */
  dynamicSuggestions?: {
    instructions: string
    minSuggestions?: number
    maxSuggestions?: number
    available?: AiChatSuggestionAvailability
  }
  /** `true` (default) renders the package line, `false` renders nothing, a component replaces it, `{ text }` re-words it per kind. */
  errorLine?: boolean | FC<ChatFailureLineProps> | { text?: ChatFailureText }
  feedback?: {
    onThumbsUp?: (message: CopilotChatFeedbackMessage) => void
    onThumbsDown?: (message: CopilotChatFeedbackMessage) => void
  }
}

/** The provider props forwarded 1:1; everything else on `CopilotKitProviderProps` is deliberately unreachable. */
export type AiChatProviderProps = Pick<
  CopilotKitProviderProps,
  | 'headers'
  | 'credentials'
  | 'properties'
  | 'debug'
  | 'frontendTools'
  | 'humanInTheLoop'
  | 'renderToolCalls'
  | 'renderCustomMessages'
  | 'renderActivityMessages'
  | 'enableInspector'
  | 'a2ui'
  | 'openGenerativeUI'
  | 'defaultThrottleMs'
>

/**
 * Everything on `CopilotChat` a consumer may set; the agent binding and the error channel stay with the
 * package, and the view is always CopilotKit's (no `chatView`).
 */
export type AiChatChatProps = Omit<
  Partial<CopilotChatProps>,
  'agentId' | 'onError' | 'onSubmitMessage' | 'isModalDefaultOpen' | 'inspectorTools' | 'chatView'
>

// Named, not `Omit<…, keyof CopilotChatProps>`: `CopilotChatViewProps` carries a string index
// signature, so that `keyof` is `string` and the `Omit` would collapse to `{}`.
type LauncherKeys = 'header' | 'toggleButton' | 'defaultOpen' | 'open' | 'onOpenChange' | 'width'

export type AiChatSurface =
  | { kind: 'inline' }
  | ({ kind: 'sidebar' } & Pick<CopilotSidebarProps, LauncherKeys | 'position'>)
  | ({ kind: 'popup' } & Pick<CopilotPopupProps, LauncherKeys | 'height' | 'clickOutsideToClose'>)

export interface AiChatProps {
  runtimeUrl: string
  agentId: string
  provider?: AiChatProviderProps
  /**
   * Merged over the preset (see `resolveAiChat`): `labels` and the object-form slots merge key by
   * key, a string or component replaces the slot, `undefined` keys never erase a preset value.
   */
  chat?: AiChatChatProps
  /** `inline` (default) renders the chat in place; `sidebar` and `popup` add CopilotKit's launcher chrome. */
  surface?: AiChatSurface
  features?: AiChatFeatures
  /** Registered as agent context for the run; one hook per entry. */
  context?: readonly AgentContextInput[]
  theme?: AiChatTheme
  /** Fires after the package's own line is set; the raw provider event rides along for logging. */
  onError?: (failure: ChatFailure, event: ChatFailureEvent) => void
  /**
   * Per-kind copy for a failed turn over the package's neutral defaults, whatever line shows it (the
   * package's or `features.errorLine`'s component); `features.errorLine.text` still wins per kind.
   */
  failureText?: ChatFailureText
  /**
   * The consumer's own hosts, each covering its subdomains: a reply's link to one keeps its path and
   * query and shows no host label. A link to any other host but the loyalty chains' goes to its origin only.
   */
  trustedHosts?: readonly string[]
  className?: string
  /**
   * Rendered inside the provider and the chat configuration context, before the surface: the
   * place for `useFrontendTool` / `useHumanInTheLoop` / `useCopilotChatConfiguration` consumers.
   */
  children?: ReactNode
}

export type AiChatPreset = Omit<AiChatProps, 'children' | 'context' | 'onError'>

/** The lint-facing name; `AiChatProps` is the public one. */
export type AIChatRootContainerProps = AiChatProps

/** @deprecated Use `AiChatProps['chat']` (`AiChatChatProps`). */
export type AIChatOverrides = Omit<Partial<CopilotChatProps>, 'agentId'>

export interface AIChatContainerProps {
  /** The consumer's chat configuration; the package ships none of its own. */
  preset: AiChatPreset
  /** The signed-in traveller's display name; forwarded to the agent as context when present. */
  userName?: string
  className?: string
  /**
   * Merged over the preset's resolved `chat`: `labels` and `input` slot objects merge
   * key by key, anything else replaces. E.g. `chat={{ input: { disclaimer: MyDisclaimer } }}`
   * brings a disclaimer back; `chat={{ labels: { chatInputPlaceholder: '…' } }}` re-words the input.
   */
  chat?: AIChatOverrides
  /**
   * Story/test seam for registering frontend tools (`useFrontendTool` / `useHumanInTheLoop` must
   * run inside the provider): rendered next to the chat, renders nothing itself. The product
   * registers no frontend tool and passes no children.
   */
  children?: ReactNode
}
