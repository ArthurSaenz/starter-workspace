import { useAgent, useCopilotChatConfiguration } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { WireLog } from '../kit/runtime.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Runtime and auth/Agent id',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('runtime.agentId')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// What a consumer's own hook sees when rendered through `children`: the agent `useAgent()` resolves
// with no argument, and the configuration context `CopilotChat` reads.
const AgentBadge = () => {
  const { agent } = useAgent()
  const configuration = useCopilotChatConfiguration()

  return (
    <p className="border-b p-3 text-sm">
      <code>useAgent()</code> → <code>{agent.agentId}</code> · <code>useCopilotChatConfiguration()</code> →{' '}
      <code>{configuration?.agentId ?? 'none'}</code>
    </p>
  )
}

export const AgentIdOnTheWire: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          '`agentId` picks the backend agent that answers. `AIChat` hands the one id to everything that needs it — the composer, the suggestion pills and your own hooks — so every turn posts to `…/agent/travelAiAgent/run`, as the panel above the chat shows.',
          '```tsx\n<AIChat {...props} agentId="travelAiAgent" />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args, { loaded }) => {
    return (
      <AIChat {...args}>
        <WireLog runtime={runtimeOf(loaded)} runtimeUrl={args.runtimeUrl} />
        <StartRun message="hello" />
      </AIChat>
    )
  },
}

export const ChildrenHookResolvesAgent: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A component of yours in `children` calls `useAgent()` and `useCopilotChatConfiguration()` with no id and gets `travelAiAgent` from both — the line above the chat prints what they return. Nothing in the tree falls back to CopilotKit’s `default` agent.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <AgentBadge />
        <SeedTranscript messages={SHORT_EXCHANGE} />
      </AIChat>
    )
  },
}
