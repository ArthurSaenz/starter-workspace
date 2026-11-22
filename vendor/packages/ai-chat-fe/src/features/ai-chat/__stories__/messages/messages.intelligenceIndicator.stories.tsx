import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('messages.intelligenceIndicator')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Messages/Intelligence badge',
  tags: ['autodocs', 'status:out-of-scope'],
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
          'Out of scope: the badge shows the cloud memory/learning status of a CopilotKit Intelligence run, which needs a CopilotKit Cloud license key on the provider — this package does not take one, so the slot renders nothing. It would take a Cloud license and a `publicLicenseKey` prop on `AIChat`.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
