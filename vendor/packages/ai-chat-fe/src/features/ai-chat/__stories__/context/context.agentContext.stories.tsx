import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Context and state/Readables',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('context.agentContext')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const TRAVELLER_NAME = { description: 'Name of the signed-in traveller', value: 'Ada' }
const TRIP_ENTRY = { description: 'Trip under discussion', value: { destination: 'Bangkok', nights: 21 } }
const TIER_ENTRY = { description: 'Loyalty tier', value: 'Marriott Bonvoy Platinum' }

export const TravellerName: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'The one readable the product registers: the signed-in traveller’s name. It rides along with every run, so the assistant greets Ada by name without her typing it.',
          '`AIChatContainer` derives it from `userName`; on `<AIChat>` pass it through `context`:',
          "```tsx\n<AIChat {...props} context={[{ description: 'Name of the signed-in traveller', value: 'Ada' }]} />\n```",
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

export const MultipleEntries: Story = {
  args: {
    context: [TRAVELLER_NAME, TRIP_ENTRY, TIER_ENTRY],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Three readables at once — the name, the trip under discussion and the loyalty tier. Each entry goes to the agent in order; an object value such as the trip is sent as JSON text.',
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
