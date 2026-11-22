import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('composer.submit')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Composer/Custom submit',
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
          "Out of scope: CopilotKit's chat replaces an `onSubmitMessage` callback with its own send handler, so a callback there would never run and this package does not accept one. To act on a send, wrap the composer's parts through the `input` slot (see Input slots).",
      },
    },
  },
  render: () => {
    return <FeatureCardComponent feature={feature} />
  },
}
