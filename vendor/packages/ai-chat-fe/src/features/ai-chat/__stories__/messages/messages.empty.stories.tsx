import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Messages/Empty reply',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('messages.empty')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const EmptyReply: Story = {
  parameters: {
    runtime: scenarios.emptyReply,
    docs: {
      description: {
        story:
          'The assistant finished a turn without saying anything. The traveller’s message stays, no empty bubble or error appears, and the input is ready for the next message. Nothing to turn on — this is how the chat behaves.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="hello" />
      </AIChat>
    )
  },
}
