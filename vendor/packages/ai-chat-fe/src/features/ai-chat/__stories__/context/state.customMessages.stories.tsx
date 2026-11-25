import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Context and state/Custom messages',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('state.customMessages')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface CustomMessageProps {
  message: { id: string; role: string }
  position: 'before' | 'after'
}

// The renderer is asked twice per message (before and after, every role); it opts in by returning
// an element and out by returning null.
const AssistantTimestamp = (props: CustomMessageProps) => {
  const { message, position } = props

  if (position !== 'after' || message.role !== 'assistant') return null

  return <p className="text-xs text-gray-500">replied at 09:41</p>
}

export const TimestampAfterEachAssistantMessage: Story = {
  args: {
    provider: { renderCustomMessages: [{ render: AssistantTimestamp }] },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Your own element between messages. Here a "replied at 09:41" line sits under the assistant’s reply and nowhere else.',
          'CopilotKit calls each renderer before and after every message with `{ message, position, messageIndex }`; return an element to show something, `null` to skip.',
          '```tsx\n<AIChat {...props} provider={{ renderCustomMessages: [{ render: AssistantTimestamp }] }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SeedTranscript messages={SHORT_EXCHANGE} />
      </AIChat>
    )
  },
}
