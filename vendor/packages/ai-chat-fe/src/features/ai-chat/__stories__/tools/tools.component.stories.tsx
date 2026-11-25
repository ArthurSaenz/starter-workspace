import { useComponent } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { toolCallFrames } from '../../__tests__/helpers/index.js'
import type { RuntimeScenario } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Tools and generative UI/Component as tool',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('tools.component')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const COMPONENT_CALL = {
  name: 'hotelSummary',
  args: { hotel: 'Mandarin Oriental Bangkok', nights: 21 },
}

// No result in the frames: the component is a frontend tool without a handler, so core answers
// the call itself (an empty tool result) and runs again, exactly as it would on the Lambda.
const componentScenario: RuntimeScenario = {
  run: [
    { kind: 'frames', frames: toolCallFrames(COMPONENT_CALL) },
    { kind: 'reply', text: 'That is the hotel — shall I price the stay?' },
  ],
}

interface HotelSummaryProps {
  hotel?: string
  nights?: number
}

// `useComponent` spreads the parsed tool args as the component's props.
const HotelSummary = (props: HotelSummaryProps) => {
  const { hotel, nights } = props

  return (
    <div data-testid="hotel-summary" style={{ border: '1px solid currentColor', borderRadius: 8, padding: 12 }}>
      {hotel} for {nights} nights
    </div>
  )
}

const HotelSummaryTool = () => {
  useComponent({
    name: COMPONENT_CALL.name,
    description: 'A one-line summary of the hotel under discussion',
    render: HotelSummary,
  })

  return null
}

export const HotelSummaryCard: Story = {
  parameters: {
    runtime: componentScenario,
    docs: {
      description: {
        story: [
          'A plain React component the agent can show. The agent called `hotelSummary` and the component draws "Mandarin Oriental Bangkok for 21 nights" in the reply, then the agent carries on with its next message.',
          'Register it with `useComponent` in `<AIChat>`’s `children`; the tool arguments become the component’s props. Caveat: without a `parameters` schema (the package ships none) the props are whatever the model sent.',
          "```tsx\nconst HotelSummaryTool = () => {\n  useComponent({ name: 'hotelSummary', description, render: HotelSummary })\n  return null\n}\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <HotelSummaryTool />
        <StartRun message="summarise the Mandarin" />
      </AIChat>
    )
  },
}
