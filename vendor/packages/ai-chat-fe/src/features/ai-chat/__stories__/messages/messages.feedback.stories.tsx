import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Messages/Thumbs up and down',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('messages.feedback')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const ThumbsButtons: Story = {
  args: {
    features: { feedback: { onThumbsUp: fn(), onThumbsDown: fn() } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Thumbs-up and thumbs-down buttons under the reply. Clicking one calls your handler with the assistant message (see the Actions panel); where the feedback goes is up to you. The buttons appear only when a handler is set.',
          '```tsx\n<AIChat features={{ feedback: { onThumbsUp: (message) => save(message, "up"), onThumbsDown: (message) => save(message, "down") } }} />\n```',
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
