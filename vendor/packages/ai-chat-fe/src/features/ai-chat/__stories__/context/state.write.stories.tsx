import { useAgent } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import type { FakeRuntime, TripPlan } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'
import { TripPlanPanel } from '../kit/trip-plan.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Context and state/Shared state write',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('state.write')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface SentPlansProps {
  runtime: FakeRuntime
}

// The plan each run carried to the agent, read off the fake runtime — the wire side of `setState`.
const SentPlans = (props: SentPlansProps) => {
  const { runtime } = props

  // Subscribed only to re-render when a run starts or a reply lands; the run is recorded by then.
  useAgent()

  return (
    <div className="border-b p-3 font-mono text-xs text-slate-700" data-testid="sent-plans">
      <p className="mb-1 font-sans font-semibold">Plan each run sent to the agent</p>
      <ol className="space-y-0.5">
        {runtime.runs.map((run, index) => {
          const plan = run.body.state?.tripPlan as TripPlan | undefined

          const hotels = plan?.hotels
            .map((hotel) => {
              return hotel.name
            })
            .join(', ')

          return (
            // eslint-disable-next-line react/no-array-index-key -- the log only grows, one entry per run
            <li key={index}>
              run {index + 1}: {plan ? `${plan.nights ?? '—'} nights · ${hotels || 'no hotels'}` : 'no plan yet'}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export const TravellerEditsThePlan: Story = {
  parameters: {
    runtime: scenarios.tripPlanThenEdit,
    docs: {
      description: {
        story: [
          'The traveller edits the plan the agent built: drop a hotel or change the nights in the panel, then send another message. The agent works from the edited plan, and the log above the chat shows the plan each run carried.',
          '`agent.setState()` replaces the agent state locally; the next run sends it as `RunAgentInput.state`. The Lambda validates it (a malformed plan becomes the empty one), echoes it back as that run’s `STATE_SNAPSHOT` and puts it in the model’s prompt. Spread the current state: `setState` replaces it whole.',
          '```tsx\nconst { agent } = useAgent({ updates: [UseAgentUpdate.OnStateChanged] })\n\nconst removeHotel = (hotelId: string) => {\n  agent.setState({\n    ...agent.state,\n    tripPlan: { ...plan, hotels: plan.hotels.filter((hotel) => hotel.hotelId !== hotelId) },\n  })\n}\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args, { loaded }) => {
    return (
      <AIChat {...args}>
        <SentPlans runtime={runtimeOf(loaded)} />
        <TripPlanPanel editable />
        <StartRun message="Shortlist two five-star hotels in Bangkok for 21 nights." />
      </AIChat>
    )
  },
}
