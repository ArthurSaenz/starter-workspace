import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotKitProvider,
  CopilotPopup,
  CopilotSidebar,
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useCopilotKit,
} from '@copilotkit/react-core/v2'
import type { AgentContextInput } from '@copilotkit/react-core/v2'
import '@copilotkit/react-core/v2/styles.css'
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'

import { cn } from '../../../lib/utils.js'
import { TrustedHostsContext } from '../../../markdown/index.js'
import { ChatFailureComponent } from '../components/chat-failure-component.js'
import { A2UI_SURFACE_ACTIVITY_TYPE, a2uiAllowedComponents, a2uiSurfaceContentSchema } from '../services/libs.js'
import type { A2uiCatalog } from '../services/libs.js'
import { describeChatFailure, openInterrupts, resolveAiChat } from '../services/main.js'
import type { ResolvedAiChat } from '../services/main.js'
import type { AIChatRootContainerProps, ChatFailure, ChatFailureEvent } from '../types.js'
import { A2uiSurfaceGuardContainer } from './a2ui-surface-guard-container.js'

export const AIChatRootContainer = (props: AIChatRootContainerProps) => {
  const { className, theme, onError, children } = props

  const id = useId()
  const resolved = resolveAiChat(props, undefined, id)

  const {
    provider,
    chat,
    configuration,
    surface,
    suggestions,
    dynamicSuggestions,
    context,
    errorLine,
    trustedHosts,
    themeCss,
  } = resolved

  const [failure, setFailure] = useState<ChatFailure | null>(null)

  // Ahead of the consumer's own and react-core's built-in renderer: a matched consumer renderer wins.
  // Memoised because react-core wants a stable array.
  const consumerActivityRenderers = provider.renderActivityMessages

  // react-core types the catalog as `any`.
  const a2uiCatalog = provider.a2ui?.catalog as A2uiCatalog | undefined

  const renderActivityMessages = useMemo(() => {
    const guard = {
      activityType: A2UI_SURFACE_ACTIVITY_TYPE,
      content: a2uiSurfaceContentSchema(a2uiAllowedComponents(a2uiCatalog)),
      render: A2uiSurfaceGuardContainer,
    }

    return [guard, ...(consumerActivityRenderers ?? [])]
  }, [a2uiCatalog, consumerActivityRenderers])

  // The provider's `onError` fires outside its context, so the core is captured from inside it.
  const coreRef = useRef<CopilotKitCore | null>(null)

  // Provider-level rather than CopilotChat-level: the chat-scoped handler only sees errors tagged
  // with its agent id, which excludes the runtime handshake (`/info`) failure. Supplying a handler
  // also silences CopilotKit's own console.error, so the line is re-emitted for devtools and e2e.
  // An effect event behind a stable handler: the provider re-subscribes when `onError` changes
  // identity, and a consumer's inline handler or `features.errorLine.text` literal changes on every
  // render. The provider calls it from its core subscription, never during render.
  const reportFailure = useEffectEvent((event: ChatFailureEvent) => {
    // CopilotKit 1.90.0 probes `/info` (5 s budget) whenever a request has no response after 10 s —
    // every run longer than that on our buffered API Gateway, and a cold Lambda misses the budget.
    // With the agent already registered the chat still works: a run that fails says so itself.
    if (event.code === RUNTIME_INFO_FETCH_FAILED && coreRef.current?.getAgent(provider.agentId)) {
      console.warn(`[ai-chat] ${event.code} while connected, not shown:`, event.error)

      return
    }

    console.error(`[ai-chat] ${event.code}:`, event.error)

    const next = describeChatFailure(event, errorLine?.text)

    // Voice input failing leaves the conversation as it was: no banner, whose Try again would re-run
    // the last turn. The consumer's `onError` still hears of it and may say so more quietly.
    if (next.kind !== 'transcription-failed') setFailure(next)

    onError?.(next, event)
  })

  const handleError = useCallback((event: ChatFailureEvent) => {
    reportFailure(event)
  }, [])

  const clearFailure = useCallback(() => {
    setFailure(null)
  }, [])

  const ErrorLine = errorLine?.component ?? ChatFailureComponent

  return (
    <div className={cn(className, theme?.dark && 'dark')} data-ai-chat={id} data-testid="ai-chat">
      {themeCss && <style>{themeCss}</style>}
      <TrustedHostsContext value={trustedHosts}>
        <CopilotKitProvider {...provider} renderActivityMessages={renderActivityMessages} onError={handleError}>
          <CopilotChatConfigurationProvider {...configuration}>
            <CoreCapture coreRef={coreRef} />
            {children}
            {context.map((entry, index) => {
              return <AgentContextRegistrar key={index} {...entry} />
            })}
            <SuggestionsRegistrar suggestions={suggestions} />
            <SuggestionsRegistrar suggestions={dynamicSuggestions} />
            <RunStatusWatcher agentId={configuration.agentId} onRunStarted={clearFailure} />
            <InterruptReconciler agentId={configuration.agentId} />
            <RuntimeReconnector agentId={provider.agentId} onConnected={clearFailure} />
            <Surface surface={surface} chat={chat} />
            {failure && errorLine && <ErrorLine failure={failure} />}
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      </TrustedHostsContext>
    </div>
  )
}

// Hooks cannot be conditional or looped, so each context entry and the suggestion config get a
// component of their own; all of them render nothing.
type AgentContextRegistrarProps = AgentContextInput

const AgentContextRegistrar = (props: AgentContextRegistrarProps) => {
  useAgentContext(props)

  return null
}

const RUNTIME_INFO_FETCH_FAILED = 'runtime_info_fetch_failed'

type CopilotKitCore = ReturnType<typeof useCopilotKit>['copilotkit']

interface CoreCaptureProps {
  coreRef: { current: CopilotKitCore | null }
}

const CoreCapture = (props: CoreCaptureProps) => {
  const { coreRef } = props

  const { copilotkit } = useCopilotKit()

  useEffect(() => {
    coreRef.current = copilotkit

    return () => {
      coreRef.current = null
    }
  }, [copilotkit, coreRef])

  return null
}

interface SuggestionsRegistrarProps {
  suggestions: ResolvedAiChat['suggestions'] | ResolvedAiChat['dynamicSuggestions']
}

const SuggestionsRegistrar = (props: SuggestionsRegistrarProps) => {
  const { suggestions } = props

  useConfigureSuggestions(suggestions)

  return null
}

interface RunStatusWatcherProps {
  agentId: string | undefined
  onRunStarted: () => void
}

// A new turn retires the previous failure; the run-status subscription is the only signal
// CopilotChat exposes for "the traveller sent something" without overriding its submit handler.
const RunStatusWatcher = (props: RunStatusWatcherProps) => {
  const { agentId, onRunStarted } = props

  const { agent } = useAgent({ agentId, updates: [UseAgentUpdate.OnRunStatusChanged] })

  const isRunning = agent.isRunning

  useEffect(() => {
    if (isRunning) onRunStarted()
  }, [isRunning, onRunStarted])

  return null
}

interface InterruptReconcilerProps {
  agentId: string | undefined
}

// `@ag-ui/client` keeps `agent.pendingInterrupts` until the next RUN_FINISHED and refuses, before
// any request, every run whose `resume` does not answer all of them (`onInitialize`, 1.0.5);
// react-core's `useInterrupt` drops its prompt as soon as a run starts. The first two paths
// would leave a chat that refuses every message with no prompt on screen to answer:
// - a resume run that errors (an expired or foreign id) or is stopped never sends RUN_FINISHED;
// - an interrupt past its `expiresAt` is never resumed by react-core, yet stays listed;
// - a suggestion pill starts an ordinary run while the prompt waits, so pills are withheld until then.
const InterruptReconciler = (props: InterruptReconcilerProps) => {
  const { agentId } = props

  const { agent } = useAgent({ agentId, updates: [] })
  const { copilotkit } = useCopilotKit()

  useEffect(() => {
    let finished = false

    const dropIfUnfinished = () => {
      if (!finished && agent.pendingInterrupts.length > 0) agent.pendingInterrupts = []
    }

    const subscription = agent.subscribe({
      onRunInitialized: () => {
        finished = false
      },
      onRunFinishedEvent: () => {
        finished = true
      },
      onRunFailed: dropIfUnfinished,
      onRunFinalized: dropIfUnfinished,
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [agent])

  useEffect(() => {
    const withholdPills = (event: { agentId: string }) => {
      if (event.agentId === agent.agentId && openInterrupts(agent).length > 0)
        copilotkit.clearSuggestions(event.agentId)
    }

    const subscription = copilotkit.subscribe({
      // Fires before `@ag-ui/client` checks the list, so an expired entry never blocks the run.
      onAgentRunStarted: (event) => {
        if (event.agent === agent) agent.pendingInterrupts = openInterrupts(agent)
      },
      onSuggestionsStartedLoading: withholdPills,
      onSuggestionsChanged: (event) => {
        if (event.suggestions.length > 0) withholdPills(event)
      },
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [agent, copilotkit])

  return null
}

interface RuntimeReconnectorProps {
  agentId: string
  onConnected: () => void
}

// CopilotKit 1.90.0 never retries a failed `/info` handshake: the status stays `Error`, the agent is
// never registered, `useAgent` reports `isReady: false` and `CopilotChat` withholds
// `onSubmitMessage` — a composer that takes typing but whose send button stays disabled for the
// life of the provider. Its own recovery only fires after a runtime request succeeds, which a
// disabled composer can never make. Re-pointing the runtime URL is the one public path that re-runs
// the handshake. Only while the agent is missing: a mid-conversation `Error` keeps its agent (and
// thread), and CopilotKit recovers that one itself on the next request.
const RuntimeReconnector = (props: RuntimeReconnectorProps) => {
  const { agentId, onConnected } = props

  const { copilotkit } = useCopilotKit()

  useEffect(() => {
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      const runtimeUrl = copilotkit.runtimeUrl

      if (timer !== undefined || !runtimeUrl) return

      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)

      attempt += 1
      timer = setTimeout(() => {
        timer = undefined

        if (!isStranded()) return

        copilotkit.setRuntimeUrl(undefined)
        copilotkit.setRuntimeUrl(runtimeUrl)
      }, delay)
    }

    const isStranded = () => {
      return (
        copilotkit.runtimeConnectionStatus === CopilotKitCoreRuntimeConnectionStatus.Error &&
        !copilotkit.getAgent(agentId)
      )
    }

    const subscription = copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        if (status === CopilotKitCoreRuntimeConnectionStatus.Connected) {
          attempt = 0
          onConnected()
        } else if (isStranded()) {
          schedule()
        }
      },
    })

    if (isStranded()) schedule()

    return () => {
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [copilotkit, agentId, onConnected])

  return null
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

interface SurfaceProps {
  surface: ResolvedAiChat['surface']
  chat: ResolvedAiChat['chat']
}

const Surface = (props: SurfaceProps) => {
  const { surface, chat } = props

  if (surface.kind === 'inline') return <CopilotChat {...chat} />

  const { kind, ...launcherProps } = surface

  if (kind === 'sidebar') return <CopilotSidebar {...chat} {...launcherProps} />

  return <CopilotPopup {...chat} {...launcherProps} />
}
