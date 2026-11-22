import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { TripPlanPanel } from '../kit/trip-plan.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Context and state/Streaming state',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('state.streaming')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const PlanFillsInWhileTheAgentWrites: Story = {
  parameters: {
    runtime: scenarios.tripPlan,
    docs: {
      description: {
        story: [
          'The plan fills in while the agent is still writing its change: Bangkok and 21 nights first, then each hotel as soon as its name is written, greyed and "checking the catalogue…" until the catalogue confirms it and its chain, area and stars appear. If the run fails, the panel goes back to the plan as it was saved.',
          'The Lambda sends a `STATE_DELTA` with the projected plan after each piece of the `update_trip_plan` arguments (a new hotel carries `pending: true`), then the saved plan once the tool has run. The panel only has to style `pending`.',
          "```tsx\n<li className={hotel.pending ? 'text-slate-400 italic' : undefined}>\n  {hotel.name} {hotel.pending ? 'checking the catalogue…' : facts(hotel)}\n</li>\n```",
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
