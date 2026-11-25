import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { LONG_EXCHANGE, SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Surfaces and copy/Inline chat',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('surface.inline')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Empty: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The default surface — no `surface` prop. The chat fills its parent in place, with no launcher button or panel around it. A new thread opens on the welcome screen.',
      },
    },
  },
}

export const WithConversation: Story = {
  parameters: {
    docs: {
      description: {
        story: 'The same inline chat after one exchange: the traveller’s message and the assistant’s reply.',
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

export const BoundedHeight: Story = {
  decorators: [
    (StoryComponent) => {
      return (
        <div style={{ height: 320 }}>
          <StoryComponent />
        </div>
      )
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          'The host sets the height. Here the chat sits in a 320 px box with a long reply: the transcript scrolls inside the box and the page does not grow.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SeedTranscript messages={LONG_EXCHANGE} />
      </AIChat>
    )
  },
}
