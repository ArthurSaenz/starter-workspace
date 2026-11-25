import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Tools and generative UI/Default tool-call chrome',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('tools.defaultView')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const NoRendererRegistered: Story = {
  parameters: {
    runtime: scenarios.backendToolCall,
    docs: {
      description: {
        story: [
          'What a tool call looks like when nothing is registered to draw it: the agent called `lookupLoyaltyBalance` and its turn in the chat is empty — no card, no raw JSON. Only the browser console notes (in development) that the call rendered nothing.',
          'To show something, register a renderer: `toolCallRenderers()` for the neutral line (Universal tool-call line), a `*` renderer (Catch-all renderer) or one per tool name (Render a named tool).',
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
