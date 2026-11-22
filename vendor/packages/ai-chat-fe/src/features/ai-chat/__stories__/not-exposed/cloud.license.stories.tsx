import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('cloud.license')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Not exposed/Intelligence',
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
          'Out of scope: `publicLicenseKey` / `licenseToken` and the Intelligence hooks (`useMemories`, `useLearn*`) need a Copilot Cloud licence. `<AIChat>` does not accept these keys, so a consumer cannot turn them on.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
