import { cn, humaniseToolName } from '../../../lib/utils.js'

export interface AgentProgressLineProps {
  phase: AgentProgressPhase
  step: number
  maxSteps: number
  /** Raw tool names the agent is running in this step, in call order. */
  tools: readonly string[]
  /** Re-words the built-in templates; the package itself never assumes product copy. */
  labels?: AgentProgressLineLabels
  className?: string
}

/**
 * Where a run is: what the agent is doing now and how far into its step budget it is
 * (`data-testid="chat-agent-progress"`, `data-phase`, `data-step`), announced politely to a screen
 * reader. Renders nothing once the phase is `done`. Meant to be registered through
 * `agentProgressRenderers()`, not mounted directly by a consumer.
 */
export const AgentProgressLine = (props: AgentProgressLineProps) => {
  const { phase, step, maxSteps, tools, labels, className } = props

  if (phase === 'done') return null

  const activity = {
    thinking: () => {
      return (labels?.thinking ?? T.thinking)()
    },
    researching: () => {
      return (labels?.researching ?? T.researching)(tools.map(labels?.toolName ?? humaniseToolName))
    },
    answering: () => {
      return (labels?.answering ?? T.answering)()
    },
  }[phase]()

  return (
    <div
      data-testid="chat-agent-progress"
      data-phase={phase}
      data-step={step}
      role="status"
      aria-live="polite"
      // `--color-*`, not the bare shadcn name — the same reason as ToolCallLine's.
      // eslint-disable-next-line shadcn/no-arbitrary-values -- the token reference is deliberate, see ToolCallLine
      className={cn('flex flex-col text-sm text-[var(--color-muted-foreground)]', className)}
    >
      <span>{activity}</span>
      <span className="text-xs">{(labels?.step ?? T.step)(step, maxSteps)}</span>
    </div>
  )
}

export type AgentProgressPhase = 'thinking' | 'researching' | 'answering' | 'done'

export interface AgentProgressLineLabels {
  thinking?: () => string
  /** `(toolNames) => text`, each name passed through `toolName`; empty until the first lookup starts. */
  researching?: (tools: string[]) => string
  /** A raw tool name as `researching` receives it; a lower-case phrase of the name by default. */
  toolName?: (name: string) => string
  answering?: () => string
  step?: (step: number, maxSteps: number) => string
}

const T = {
  thinking: () => {
    return 'Thinking…'
  },
  researching: (tools: string[]) => {
    return tools.length === 0 ? 'Looking things up…' : `Looking up: ${tools.join(', ')}…`
  },
  answering: () => {
    return 'Writing the answer…'
  },
  step: (step: number, maxSteps: number) => {
    return `Step ${step} of up to ${maxSteps}`
  },
}
