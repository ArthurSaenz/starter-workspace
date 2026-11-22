import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('errors.chatOnError')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Errors and observability/Chat-scoped onError',
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
          'Not used: CopilotKit’s chat-level `onError` never hears about the chat failing to reach the runtime on load — the one failure the traveller must see before typing. `<AIChat onError>` (see `Error events`) covers every failure instead, so there is nothing to unblock.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
