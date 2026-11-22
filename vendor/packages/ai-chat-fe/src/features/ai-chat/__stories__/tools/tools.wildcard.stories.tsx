import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Catch-all renderer',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('tools.wildcard')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface WildcardCardProps {
  name: string
  args: Record<string, unknown>
  status: string
  result: string | undefined
}

// The `*` renderer sees every tool call nobody named — `name` is the only thing it can key on.
const WildcardToolCard = (props: WildcardCardProps) => {
  const { name, args, status, result } = props

  return (
    <div data-testid="wildcard-card" data-tool-name={name} data-status={status} style={{ padding: 12 }}>
      <strong>{name}</strong>({JSON.stringify(args)}) → {result ?? status}
    </div>
  )
}

export const WildcardCard: Story = {
  args: {
    provider: {
      renderToolCalls: [{ name: '*', render: WildcardToolCard }],
    },
  },
  parameters: {
    runtime: scenarios.backendToolCall,
    docs: {
      description: {
        story: [
          'One renderer for every tool call that has no renderer of its own. The agent called `lookupLoyaltyBalance`, which nothing names, and the catch-all card shows the tool name, its arguments and its result inside the reply.',
          'Turn it on with a `*` entry in `provider.renderToolCalls` (or `useDefaultRenderTool()` in `children`). Named renderers still win for their own tools.',
          "```tsx\n<AIChat provider={{ renderToolCalls: [{ name: '*', render: WildcardToolCard }] }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="points?" />
      </AIChat>
    )
  },
}
