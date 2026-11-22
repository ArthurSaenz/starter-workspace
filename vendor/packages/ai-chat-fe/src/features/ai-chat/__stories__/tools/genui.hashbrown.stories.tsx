import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('genui.hashbrown')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Hashbrown',
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
          'Hashbrown (`@hashbrownai/react`) streams structured UI from inside a tool renderer. Nothing blocks it — a consumer can call it from a `provider.renderToolCalls` renderer (see Render a named tool) — but this package does not ship it.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
