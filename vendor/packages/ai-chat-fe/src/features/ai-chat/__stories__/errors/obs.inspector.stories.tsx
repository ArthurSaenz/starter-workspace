import type { Meta, StoryObj } from '@storybook/react'

import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Errors and observability/Inspector',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('obs.inspector')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Off by default: just the chat, no developer panel.',
      },
    },
  },
}

export const Enabled: Story = {
  args: { provider: { enableInspector: true } },
  parameters: {
    docs: {
      description: {
        story: [
          'Turned on, CopilotKit’s floating developer panel appears in a corner of the page, showing the agent, its messages and the events of each turn. It only ever shows on `localhost` in a development build — here under `storybook dev`, never in a built Storybook or in production.',
          '```tsx\n<AIChat {...props} provider={{ enableInspector: true }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
