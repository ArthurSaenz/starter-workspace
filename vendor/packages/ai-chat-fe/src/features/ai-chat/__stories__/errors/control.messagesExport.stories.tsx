import { UseAgentUpdate, useAgent } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Read the transcript',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('control.messagesExport')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// `agent.messages` is the same array the chat renders, and `OnMessagesChanged` re-renders this badge
// as it grows.
const TranscriptBadge = () => {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnMessagesChanged] })

  const roles = agent.messages.map((message) => {
    return message.role
  })

  return (
    <p className="border-b p-3 text-sm">
      transcript: {agent.messages.length} message(s) · {roles.join(' → ') || 'empty'}
    </p>
  )
}

export const TranscriptLength: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Read the conversation from your own code — to save it, export it or send it to support. `useAgent().agent.messages` in `<AIChat>`’s `children` is exactly what the chat shows; the badge above reads "transcript: 2 message(s) · user → assistant". Ask something and watch it grow.',
          '```tsx\nconst { agent } = useAgent({ updates: [UseAgentUpdate.OnMessagesChanged] })\nconst transcript = agent.messages\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <TranscriptBadge />
        <SeedTranscript messages={SHORT_EXCHANGE} />
      </AIChat>
    )
  },
}
