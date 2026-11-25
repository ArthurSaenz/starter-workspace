import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Messages/Edit user message and branches',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('messages.userEdit')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const EditButton: Story = {
  args: {
    chat: { messageView: { userMessage: { onEditMessage: fn(), onSwitchToBranch: fn() } } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'A pencil button on the traveller’s message, next to its copy button — hover the bubble to see it. Clicking it calls your handler with `{ message }` (see the Actions panel); no editor opens by itself, so what an edit means is up to you. Branch arrows (previous/next version of a message) never appear in this CopilotKit version, so `onSwitchToBranch` has no effect.',
          '```tsx\n<AIChat chat={{ messageView: { userMessage: { onEditMessage: ({ message }) => edit(message) } } }} />\n```',
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
