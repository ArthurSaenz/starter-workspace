import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Messages/Copy message or code',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('messages.copy'), {
    render: (args) => {
      return (
        <AIChat {...args}>
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

const NoCopyButton = () => {
  return null
}

export const CopyButtons: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'On by default. The reply carries a copy button in its toolbar; the traveller’s bubble shows its own when hovered. Clicking one copies the message text and the icon turns into a check mark for two seconds. Code blocks in a markdown reply get their own copy control.',
      },
    },
  },
}

export const CopyButtonsOff: Story = {
  args: {
    chat: {
      messageView: {
        assistantMessage: { copyButton: NoCopyButton },
        userMessage: { copyButton: NoCopyButton },
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Both copy buttons replaced by a component that renders nothing. The toolbar stays, so other toolbar buttons keep their place; to drop the whole toolbar use `assistantMessage.toolbarVisible: false` (see Message slots).',
          '```tsx\nconst NoCopyButton = () => null\n\n<AIChat chat={{ messageView: { assistantMessage: { copyButton: NoCopyButton }, userMessage: { copyButton: NoCopyButton } } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
