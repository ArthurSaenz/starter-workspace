import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Context and state/Forwarded properties',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('context.properties')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const PropertiesOnTheWire: Story = {
  args: {
    provider: { properties: { travellerTier: 'platinum', locale: 'en-GB' } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Per-run metadata for the agent, sent with every run as `forwardedProps`. The traveller sees an ordinary reply — the Lambda graph reads none of it yet, which is why it is off by default.',
          "```tsx\n<AIChat {...props} provider={{ properties: { travellerTier: 'platinum', locale: 'en-GB' } }} />\n```",
        ].join('\n\n'),
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
