import type { Meta, StoryObj } from '@storybook/react'

import { BACKEND_TOOL_CALL, scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Render a named tool',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('tools.renderByName')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface LoyaltyBalanceProps {
  args: { programme?: string }
  status: string
  result: string | undefined
}

// A renderer, not a tool: nothing is registered for the agent to call, so the name never reaches
// the wire — only a backend-emitted TOOL_CALL for it lands here.
const LoyaltyBalance = (props: LoyaltyBalanceProps) => {
  const { args, status, result } = props

  return (
    <div data-testid="loyalty-balance" data-status={status} style={{ border: '1px solid currentColor', padding: 12 }}>
      {args.programme ?? '…'} · {status} · {result ?? 'no result yet'}
    </div>
  )
}

export const LoyaltyBalanceCard: Story = {
  args: {
    provider: {
      renderToolCalls: [{ name: BACKEND_TOOL_CALL.name, render: LoyaltyBalance }],
    },
  },
  parameters: {
    runtime: scenarios.backendToolCall,
    docs: {
      description: {
        story: [
          'Your own UI for a tool the backend runs. The agent called `lookupLoyaltyBalance` on the server, and the chat draws its card — "Marriott Bonvoy · complete · {"points":128000}" — inside the reply instead of nothing.',
          'Turn it on with `provider.renderToolCalls`, one entry per tool name. It is only a renderer: the agent is not offered a new tool.',
          "```tsx\n<AIChat provider={{ renderToolCalls: [{ name: 'lookupLoyaltyBalance', render: LoyaltyBalance }] }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="how many points do I have?" />
      </AIChat>
    )
  },
}
