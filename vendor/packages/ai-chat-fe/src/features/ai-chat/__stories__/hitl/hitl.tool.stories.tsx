import type { Meta, StoryObj } from '@storybook/react'

import { ConfirmBudget } from '../../__tests__/helpers/demo-tools.js'
import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { TalkPastPrompt } from '../kit/hitl.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Human in the loop/Approval tool',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('hitl.tool')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const AwaitingAnswer: Story = {
  parameters: {
    runtime: scenarios.humanInTheLoop,
    docs: {
      description: {
        story: [
          'The agent asks before it acts. It called `confirmBudget`, and the prompt "Keep it under $4200?" waits in the reply with Yes / No; the agent continues only once the traveller answers. Click Yes to see the reply that follows. The product ships no approval tool yet; this one is a demo.',
          'Caveat: while it waits the chat does not look busy — no cursor, the send arrow, the input open. `useAwaitingToolCall()` tells a custom composer to hold the input.',
          "```tsx\nconst ConfirmBudget = () => {\n  useHumanInTheLoop({ name: 'confirmBudget', description, render: ({ args, respond, status }) => … })\n  return null\n}\n\n<AIChat {...props}>\n  <ConfirmBudget />\n</AIChat>\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <ConfirmBudget />
        <StartRun message="budget?" />
      </AIChat>
    )
  },
}

export const TalkedPastPrompt: Story = {
  parameters: {
    runtime: scenarios.humanInTheLoop,
    docs: {
      description: {
        story:
          'The caveat in action: instead of answering, the traveller typed another message. The agent replied to it straight away, and the budget prompt above is still open and still answerable — nothing in the default chat stops a traveller from talking past an approval.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <ConfirmBudget />
        <StartRun message="budget?" />
        <TalkPastPrompt />
      </AIChat>
    )
  },
}
