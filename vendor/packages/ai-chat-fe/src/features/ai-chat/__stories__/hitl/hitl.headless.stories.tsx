import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { TRIP_PLAN_TO_CONFIRM, scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { HeadlessTripPlanConfirmation } from '../kit/trip-plan-confirmation.js'
import { TripPlanPanel } from '../kit/trip-plan.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Human in the loop/Headless interrupts',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('hitl.headless')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const PLAN_STATE = { tripPlan: TRIP_PLAN_TO_CONFIRM }

// The side panel is a sibling of `AIChat`, so the hook (which needs the provider) mounts inside the
// chat's `children` and portals its card out.
const ChatWithSidePanel = (props: AiChatProps) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 border-r bg-slate-50" data-testid="side-panel">
        <p className="p-3 text-sm font-semibold">{T.panelTitle}</p>
        <div ref={setSlot} />
      </aside>
      <AIChat {...props} className="min-w-0 flex-1">
        <TripPlanPanel />
        <HeadlessTripPlanConfirmation slot={slot} />
        <StartRun message="Drop Park Hyatt from my plan." state={PLAN_STATE} />
      </AIChat>
    </div>
  )
}

export const ConfirmationInSidePanel: Story = {
  parameters: {
    runtime: scenarios.tripPlanConfirmation,
    docs: {
      description: {
        story: [
          'The same confirmation as Agent interrupt, drawn in a panel beside the chat instead of the transcript: the traveller asked to drop Park Hyatt, and Allow / Keep my plan wait in the side panel. The transcript shows nothing for it.',
          '`useInterrupt({ renderInChat: false, render })` returns the card (or `null`) rather than publishing it into the chat; place it anywhere — here through a portal, because the hook must mount under `AIChat` and the panel is outside it. Answering works exactly as in the chat: `resolve()` / `cancel()` start the run that carries `resume`.',
          '```tsx\nconst Confirmation = ({ slot }) => {\n  const card = useInterrupt({ renderInChat: false, render: ({ interrupt, resolve, cancel }) => <Card … /> })\n  return card && slot ? createPortal(card, slot) : null\n}\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return <ChatWithSidePanel {...args} />
  },
}

const T = {
  panelTitle: 'Needs your answer',
}
