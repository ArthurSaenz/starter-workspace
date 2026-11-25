import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Composer/Stop generation',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('composer.stop')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Running: Story = {
  parameters: {
    runtime: scenarios.stopGeneration,
    docs: {
      description: {
        story:
          'On by default. While a reply is on its way the send button becomes a square stop button; here the reply takes 3 seconds. Clicking stop tells the server to stop the run, but the chat keeps waiting until the reply arrives anyway — this CopilotKit version does not cancel the request (on our backend that can be up to 29 s).',
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
