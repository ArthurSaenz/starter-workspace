import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { TripPlanPanel } from '../kit/trip-plan.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Context and state/Shared state read',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('state.read')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const TripPlanBesideTheChat: Story = {
  parameters: {
    runtime: scenarios.tripPlanAtOnce,
    docs: {
      description: {
        story: [
          'The trip plan the agent keeps for this conversation, shown above the chat: destination, nights and the hotels it shortlisted with their chain, area and stars. The agent updates it with its `update_trip_plan` tool; the panel re-renders whenever the plan changes.',
          'The Lambda sends the plan as AG-UI state: a `STATE_SNAPSHOT` when the run starts, then a `STATE_DELTA` replacing `/tripPlan` each time the agent writes it. Any component under `AIChat` reads it with `useAgent`.',
          '```tsx\nconst { agent } = useAgent({ updates: [UseAgentUpdate.OnStateChanged] })\nconst plan = (agent.state as { tripPlan?: TripPlan }).tripPlan\n\n<AIChat {...props}>\n  <TripPlanPanel />\n</AIChat>\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <TripPlanPanel />
        <StartRun message="Shortlist two five-star hotels in Bangkok for 21 nights." />
      </AIChat>
    )
  },
}
