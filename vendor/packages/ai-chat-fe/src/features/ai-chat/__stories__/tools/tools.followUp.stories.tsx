import type { Meta, StoryObj } from '@storybook/react'

import { TOOL_CALL, toolCallFrames } from '../../__tests__/helpers/index.js'
import type { RuntimeScenario } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { showHotelCardTool } from '../kit/tools.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Follow-up run',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('tools.followUp')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// No TOOL_CALL_RESULT in the frames: the browser's handler answers the call, which is what decides
// whether core runs again.
const handlerAnswers = (secondReply: string): RuntimeScenario => {
  return {
    run: [
      { kind: 'frames', frames: toolCallFrames({ name: TOOL_CALL.name, args: TOOL_CALL.args }) },
      { kind: 'reply', text: secondReply },
    ],
  }
}

export const FollowUpReply: Story = {
  args: {
    provider: { frontendTools: [showHotelCardTool] },
  },
  parameters: {
    runtime: handlerAnswers('The card is up — want me to price those 21 nights?'),
    docs: {
      description: {
        story: [
          'The default. Once the browser tool has answered (the hotel card reads "complete"), the agent runs again on its own and reacts to the result — the reply under the card came without the traveller typing anything.',
          'Nothing to turn on: `followUp` is on unless a tool sets it to `false` (see NoFollowUp).',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="show me the Mandarin" />
      </AIChat>
    )
  },
}

export const NoFollowUp: Story = {
  args: {
    provider: { frontendTools: [{ ...showHotelCardTool, followUp: false }] },
  },
  parameters: {
    runtime: handlerAnswers('Sure — here is the total.'),
    docs: {
      description: {
        story: [
          'The same tool with `followUp: false`: the card completes and the chat goes quiet — the agent does not run again. The result is not lost; it goes to the agent with whatever the traveller sends next.',
          "```tsx\n<AIChat provider={{ frontendTools: [{ name: 'showHotelCard', handler, render, parameters, followUp: false }] }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="show me the Mandarin" />
      </AIChat>
    )
  },
}
