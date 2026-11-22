import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Messages/Read aloud',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('messages.readAloud')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const ReadAloudButton: Story = {
  args: {
    chat: { messageView: { assistantMessage: { onReadAloud: fn() } } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'A speaker button under the reply. Clicking it calls your handler with the assistant message (see the Actions panel) — CopilotKit plays no audio itself, so the handler does the speaking, e.g. with `speechSynthesis`. The button appears only when a handler is set.',
          '```tsx\n<AIChat chat={{ messageView: { assistantMessage: { onReadAloud: (message) => speak(message.content) } } }} />\n```',
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
