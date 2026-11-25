import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('dev.unsafeAgents')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Not exposed/In-browser agents',
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
          'Out of scope: `agents__unsafe_dev_only` / `selfManagedAgents` run an agent in the browser and bypass the runtime — and with it the session cookie and the Lambda. `<AIChat>` does not accept them and drops them if a preset passes them anyway.',
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
