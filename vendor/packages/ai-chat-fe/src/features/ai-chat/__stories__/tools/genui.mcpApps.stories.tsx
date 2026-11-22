import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('genui.mcpApps')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/MCP Apps',
  tags: ['autodocs', 'status:backend-blocked'],
  ...defineFeatureMeta(feature),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Overview: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'MCP Apps draw the surfaces of an MCP app server inside the chat. We cannot use it: the backend has no MCP app server and sends no activity events, and the package does not expose the renderer — both would be needed to unblock it.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
