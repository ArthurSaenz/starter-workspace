import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET, scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { LONG_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Surfaces and copy/Auto-scroll',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('copy.autoScroll'), {
    parameters: {
      // Any message sent in these stories gets the long reply back, so the scroll behaviour can be tried live.
      runtime: scenarios.markdownReply,
    },
    render: (args) => {
      return (
        <AIChat {...args}>
          <SeedTranscript messages={LONG_EXCHANGE} />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const PinToBottom: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The default (`chat.autoScroll` unset): the transcript stays pinned to the bottom, so the end of a long reply is in view as it arrives. Send any message to watch a new long reply scroll in.',
      },
    },
  },
}

export const None: Story = {
  args: {
    chat: { ...NOMADREAM_PRESET.chat, autoScroll: 'none' },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`chat.autoScroll: "none"`: the chat never scrolls on its own. A new reply lands below the fold and the traveller scrolls down to read it.',
      },
    },
  },
}
