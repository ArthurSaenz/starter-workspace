import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { A2uiActionLog } from '../kit/a2ui.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/A2UI',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('genui.a2ui')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const QUESTION = 'Compare Park Hyatt Bangkok and JW Marriott Hotel Bangkok side by side'

export const HotelComparison: Story = {
  parameters: {
    runtime: scenarios.a2uiComparison,
    docs: {
      description: {
        story: [
          'Asked to compare, the agent answers with a sentence and a surface it composes from the basic catalog: a title, one card per hotel with the catalogue facts (stars, area, chain — never a price), an "Add to trip plan" button on each, and the source.',
          'The Lambda runs CopilotKit’s A2UI middleware: the model calls `render_a2ui`, the middleware streams the surface as an `a2ui-surface` activity and answers the call itself. The chat draws it once `/info` reports `a2uiEnabled`; the preset only keeps the browser’s own catalog schema off the wire, because the model reads the Lambda’s.',
          '```tsx\n<AIChat {...props} provider={{ a2ui: { includeSchema: false } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message={QUESTION} />
      </AIChat>
    )
  },
}

export const AddToTripPlan: Story = {
  parameters: {
    runtime: scenarios.a2uiComparison,
    docs: {
      description: {
        story: [
          'Press "Add to trip plan" on a card: the click is a new turn. It goes back as `forwardedProps.a2uiAction` — the action name, the surface and the context the agent put on the button (here the hotel id and name), listed in the panel above the chat — and the middleware hands it to the agent as a user message of its own, `A2UI user action:` and the press as JSON, which is never shown or kept. The agent answers it; on the Lambda it adds the hotel to the trip plan.',
        ].join('\n\n'),
      },
    },
  },
  render: (args, { loaded }) => {
    return (
      <AIChat {...args}>
        <A2uiActionLog runtime={runtimeOf(loaded)} />
        <StartRun message={QUESTION} />
      </AIChat>
    )
  },
}
