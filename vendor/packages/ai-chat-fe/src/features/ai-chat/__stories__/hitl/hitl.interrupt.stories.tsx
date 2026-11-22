import type { Meta, StoryObj } from '@storybook/react'

import { TRIP_PLAN_TO_CONFIRM, scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { InChatTripPlanConfirmation, TalkPastConfirmation } from '../kit/trip-plan-confirmation.js'
import { TripPlanPanel } from '../kit/trip-plan.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Human in the loop/Agent interrupt',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('hitl.interrupt')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const PLAN_STATE = { tripPlan: TRIP_PLAN_TO_CONFIRM }

const REMOVE_MESSAGE = 'Drop Park Hyatt from my plan.'

export const AwaitingConfirmation: Story = {
  parameters: {
    runtime: scenarios.tripPlanConfirmation,
    docs: {
      description: {
        story: [
          'The traveller asked to drop Park Hyatt. Taking a hotel out of the plan (or replacing a destination or a length of stay already set) is not done silently: the agent stops and the confirmation waits under the conversation, naming exactly what would change. Allow removes the hotel and the agent says so; Keep my plan leaves the plan as it was and the agent will not try again.',
          'The run ends with `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [{ id, reason: "confirm_trip_plan_change", message, expiresAt, metadata: { removals, changes }, responseSchema }] } }` — `responseSchema` types the answer as `{ approved: boolean }`. `useInterrupt` renders it; `resolve({ approved })` (or `cancel()` for a question left unanswered) starts the next run with `RunAgentInput.resume: [{ interruptId, status: "resolved" | "cancelled", payload }]`, and the paused graph continues from its checkpoint. A cancel is a refusal.',
          "```tsx\nconst TripPlanConfirmation = () => {\n  useInterrupt({\n    enabled: (event) => event.value?.reason === 'confirm_trip_plan_change',\n    render: ({ interrupt, resolve }) => (\n      <Card changes={interrupt.metadata} onAllow={() => resolve({ approved: true })} onKeep={() => resolve({ approved: false })} />\n    ),\n  })\n  return null\n}\n\n<AIChat {...props}>\n  <TripPlanConfirmation />\n</AIChat>\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <TripPlanPanel />
        <InChatTripPlanConfirmation />
        <StartRun message={REMOVE_MESSAGE} state={PLAN_STATE} />
      </AIChat>
    )
  },
}

export const TalkedPastConfirmation: Story = {
  parameters: {
    runtime: scenarios.tripPlanConfirmation,
    docs: {
      description: {
        story: [
          'Instead of answering, the traveller sent another message. Unlike an approval tool, an open interrupt blocks the conversation: `@ag-ui/client` refuses any run that does not answer it, before a request leaves the browser, so the message stays unanswered, the chat shows its error line, and the confirmation above stays open and answerable.',
          'The chat’s own input does not know this. A composer that must not send meanwhile reads `useAwaitingInterrupt()` (true while an interrupt waits for its answer) and holds Enter and the send button — the client app does, with a hint pointing at the confirmation. While it is open `AIChat` also withholds the suggestion pills, which would start the same refused run.',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <TripPlanPanel />
        <InChatTripPlanConfirmation />
        <StartRun message={REMOVE_MESSAGE} state={PLAN_STATE} />
        <TalkPastConfirmation />
      </AIChat>
    )
  },
}
