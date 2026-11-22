import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('cloud.publicApiKey')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Not exposed/Copilot Cloud',
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
          'Out of scope: `publicApiKey` (and the `guardrails_c` it unlocks) would route the chat through Copilot Cloud instead of the NomaDream Lambda. `<AIChat>` does not accept it and drops it if a preset passes it anyway, so the runtime URL and the session cookie stay the only path.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
