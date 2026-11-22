import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { WireLog } from '../kit/runtime.js'
import { runtimeOf } from '../kit/story-kit.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Runtime and auth/Runtime handshake',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('runtime.info'), {
    render: (args, { loaded }) => {
      return (
        <AIChat {...args}>
          <WireLog runtime={runtimeOf(loaded)} runtimeUrl={args.runtimeUrl} />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const InfoOk: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'On open the chat asks the runtime what it offers (`GET …/info`, listed in the panel above the chat) before anything is typed. It answered, so the welcome screen is ready and a message you type gets a reply.',
      },
    },
  },
}

export const InfoUnauthorized: Story = {
  parameters: {
    runtime: scenarios.infoUnauthorized,
    docs: {
      description: {
        story:
          'The handshake fails (a 401, as with an expired session): the chat still shows its welcome screen, with the red line “The assistant is unavailable right now. Reload the page to try again.” under the input. Typing and pressing Enter does nothing until the page is reloaded.',
      },
    },
  },
}
