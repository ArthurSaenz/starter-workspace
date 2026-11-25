import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Surfaces and copy/Headless hooks',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('surface.headless')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// What apps/client's ChatRunControl does, made visible: no agent id is passed anywhere — every hook
// resolves to the configured agent because the panel sits in `AIChat`'s `children`.
const RunPanel = () => {
  const { agent } = useAgent()
  const { copilotkit } = useCopilotKit()

  const stop = () => {
    copilotkit.stopAgent({ agent })
  }

  const retry = () => {
    const lastUserMessage = agent.messages
      .map((message) => {
        return message.role
      })
      .lastIndexOf('user')

    if (lastUserMessage === -1) return

    agent.setMessages(agent.messages.slice(0, lastUserMessage + 1))
    void copilotkit.runAgent({ agent })
  }

  return (
    <div className="flex items-center gap-3 border-b p-3 text-sm">
      <span>
        Agent <code>{agent.agentId}</code> · {agent.messages.length} messages · {agent.isRunning ? 'running' : 'idle'}
      </span>
      <button type="button" className="rounded border px-2 py-1" disabled={!agent.isRunning} onClick={stop}>
        Stop
      </button>
      <button type="button" className="rounded border px-2 py-1" disabled={agent.isRunning} onClick={retry}>
        Retry last question
      </button>
    </div>
  )
}

export const RunControls: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Your own UI next to the chat, driving the same agent. Put a component in `<AIChat>`’s `children` and call `useAgent()` / `useCopilotKit()` from `@wl/ai-chat-fe` — no agent id needed: `children` sit inside the chat’s provider, so every hook gets `travelAiAgent`.',
          'The panel above the chat reads the agent, its messages and its run status, and its buttons stop the run or ask the last question again. apps/client builds its Stop / Retry and chat-history restore this way (`ChatRunControl`, `ChatHistorySync`).',
          '```tsx\n<AIChat {...props}>\n  <RunPanel />\n</AIChat>\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <RunPanel />
        <SeedTranscript messages={SHORT_EXCHANGE} />
      </AIChat>
    )
  },
}
