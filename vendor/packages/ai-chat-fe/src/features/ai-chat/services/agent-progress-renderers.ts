import { UseAgentUpdate, useAgent } from '@copilotkit/react-core/v2'
import type { ReactActivityMessageRenderer } from '@copilotkit/react-core/v2'
import { createElement } from 'react'
import type { ComponentProps } from 'react'

import { AgentProgressLine } from '../components/agent-progress-line.js'
import type { AgentProgressLineLabels, AgentProgressPhase } from '../components/agent-progress-line.js'

export interface AgentProgressRenderersOptions {
  labels?: AgentProgressLineLabels
  /** The `activityType` the agent publishes its progress under; the ai-chat Lambda's is the default. */
  activityType?: string
}

export interface AgentProgressContent {
  phase: AgentProgressPhase
  step: number
  maxSteps: number
  tools: string[]
}

type ProgressRenderer = ReactActivityMessageRenderer<AgentProgressContent>
type ProgressRenderProps = ComponentProps<ProgressRenderer['render']>

export const AGENT_PROGRESS_ACTIVITY_TYPE = 'agent-progress'

const PHASES: readonly string[] = ['thinking', 'researching', 'answering', 'done']

const isProgressContent = (value: unknown): value is AgentProgressContent => {
  if (typeof value !== 'object' || value === null) return false

  const { phase, step, maxSteps, tools } = value as Record<string, unknown>

  return (
    typeof phase === 'string' &&
    PHASES.includes(phase) &&
    typeof step === 'number' &&
    typeof maxSteps === 'number' &&
    Array.isArray(tools) &&
    tools.every((tool) => {
      return typeof tool === 'string'
    })
  )
}

// Hand-written rather than zod: the package's runtime dependencies stay CopilotKit, clsx and
// tailwind-merge (readme "Portability contract"). Synchronous on purpose — react-core drops an
// activity whose validation returns a Promise.
const progressContentSchema: ProgressRenderer['content'] = {
  '~standard': {
    version: 1,
    vendor: '@wl/ai-chat-fe',
    validate: (value) => {
      return isProgressContent(value)
        ? { value }
        : { issues: [{ message: 'Not agent-progress content: { phase, step, maxSteps, tools }' }] }
    },
  },
}

/**
 * One `renderActivityMessages` entry for the agent's progress activity (`ACTIVITY_SNAPSHOT` once
 * per run, then `ACTIVITY_DELTA` patches): a live `AgentProgressLine` while the run is under way.
 * It renders nothing once the run has ended — whatever the last phase says — so a restored
 * transcript never shows a stale "Thinking…".
 */
export const agentProgressRenderers = (options?: AgentProgressRenderersOptions): ProgressRenderer[] => {
  const labels = options?.labels
  const activityType = options?.activityType ?? AGENT_PROGRESS_ACTIVITY_TYPE

  const AgentProgressActivity = (props: ProgressRenderProps) => {
    const { content, agent, message } = props

    const { agent: liveAgent } = useAgent({
      agentId: agent?.agentId,
      updates: [UseAgentUpdate.OnRunStatusChanged, UseAgentUpdate.OnMessagesChanged],
    })

    // Only the newest card of the current turn can belong to the run under way: a stopped turn
    // never sent `done`, and its card would otherwise come back to life on the next run.
    const { messages } = liveAgent

    const latestIndex = messages.findLastIndex((candidate) => {
      return candidate.role === 'activity' && candidate.activityType === activityType
    })

    const lastUserIndex = messages.findLastIndex((candidate) => {
      return candidate.role === 'user'
    })

    const isCurrent = latestIndex > lastUserIndex && messages[latestIndex]?.id === message.id

    if (!liveAgent.isRunning || !isCurrent) return null

    return createElement(AgentProgressLine, { ...content, labels })
  }

  return [
    {
      activityType,
      content: progressContentSchema,
      render: AgentProgressActivity,
    },
  ]
}
