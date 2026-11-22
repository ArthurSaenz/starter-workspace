import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { WireLog } from '../kit/runtime.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Runtime and auth/Cookies',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('runtime.credentials')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const SameOriginCredentials: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          "The traveller’s session cookie is the credential: every request goes out with `credentials: 'same-origin'`, set by the preset and the package default when you set nothing. The panel above the chat shows it on the handshake and on the turn.",
          "```tsx\n<AIChat {...props} provider={{ credentials: 'same-origin' }} />\n```",
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
