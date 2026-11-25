import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Messages/Regenerate',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('messages.regenerate')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const RegenerateButton: Story = {
  args: {
    chat: { messageView: { assistantMessage: { onRegenerate: fn() } } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'A regenerate button under the reply. Clicking it calls your handler with the assistant message (see the Actions panel); CopilotKit does not re-run the turn by itself — the handler asks the agent again if that is what you want. The button appears only when a handler is set.',
          '```tsx\n<AIChat chat={{ messageView: { assistantMessage: { onRegenerate: (message) => askAgain(message) } } }} />\n```',
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
