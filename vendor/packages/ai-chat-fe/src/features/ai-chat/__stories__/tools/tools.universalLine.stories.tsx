import type { Meta, StoryObj } from '@storybook/react'

import { BACKEND_TOOL_CALL, scenarios, toolCallFrames } from '../../__tests__/helpers/index.js'
import type { RuntimeScenario } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { toolCallRenderers } from '../../services/main.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Tools and generative UI/Universal tool-call line',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('tools.universalLine')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// No result in the frames and nobody in the browser to produce one, so the call stays open.
const openBackendCall: RuntimeScenario = {
  run: { kind: 'frames', frames: toolCallFrames({ name: BACKEND_TOOL_CALL.name, args: BACKEND_TOOL_CALL.args }) },
}

export const Checked: Story = {
  args: { provider: { renderToolCalls: toolCallRenderers() } },
  parameters: {
    runtime: scenarios.backendToolCall,
    docs: {
      description: {
        story: [
          'The package’s own line for any tool call: after the agent’s `lookupLoyaltyBalance` finished, the reply shows a neutral "Checked lookup loyalty balance" — no product copy, no result value.',
          'Turn it on with `provider.renderToolCalls: toolCallRenderers()`; `toolCallRenderers({ labels })` re-words the two templates.',
          '```tsx\n<AIChat provider={{ renderToolCalls: toolCallRenderers() }} />\n```',
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

export const LookingUp: Story = {
  args: { provider: { renderToolCalls: toolCallRenderers() } },
  parameters: {
    runtime: openBackendCall,
    docs: {
      description: {
        story:
          'The same line while the tool call has no result yet: "Looking up lookup loyalty balance…". It turns into "Checked …" once the result arrives.',
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
