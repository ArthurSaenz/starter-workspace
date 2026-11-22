import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Theming and styling/Class overrides',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('theme.classNames'), {
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

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Off by default: no `chat.*` slot carries a class of yours, so the conversation is laid out with CopilotKit’s own classes only — the first message sits just under the top edge.',
      },
    },
  },
}

export const ClassNameSlot: Story = {
  args: { chat: { messageView: 'pt-10' } },
  parameters: {
    docs: {
      description: {
        story: [
          'A slot given as a string is a className. Here the message list gets `pt-10`, so the conversation starts 40px lower; CopilotKit’s own classes stay on the element next to yours.',
          "```tsx\n<AIChat {...props} chat={{ messageView: 'pt-10' }} />\n```",
        ].join('\n\n'),
      },
    },
  },
}
