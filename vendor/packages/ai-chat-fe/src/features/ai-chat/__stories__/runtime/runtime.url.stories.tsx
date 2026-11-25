import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { WireLog } from '../kit/runtime.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Runtime and auth/Runtime URL',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('runtime.url')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Every request the chat makes hangs off `runtimeUrl` — the preset’s same-origin `/api/v1/ai/copilotkit`. The panel above the chat lists them: the `GET …/info` handshake on open, then `POST …/agent/travelAiAgent/run` for the turn that produced the reply.',
          '```tsx\n<AIChat runtimeUrl="/api/v1/ai/copilotkit" agentId="travelAiAgent" />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args, { loaded }) => {
    return (
      <AIChat {...args}>
        <WireLog runtime={runtimeOf(loaded)} runtimeUrl={args.runtimeUrl} />
        <StartRun message="hello" />
      </AIChat>
    )
  },
}
