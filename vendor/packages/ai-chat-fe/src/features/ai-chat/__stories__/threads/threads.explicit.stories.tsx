import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import type { KeptThread } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { LONG_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Threads/Explicit threadId',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('threads.explicit')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const KEPT_THREAD_ID = 'kept-bangkok-stay'

const KEPT_THREAD: KeptThread = {
  id: KEPT_THREAD_ID,
  name: 'three weeks in Bangkok',
  messages: LONG_EXCHANGE,
  updatedAt: '2026-10-01T10:00:00.000Z',
}

export const RestoredConversation: Story = {
  parameters: {
    runtime: { ...scenarios.default, threads: [KEPT_THREAD] },
    docs: {
      description: {
        story: [
          'A conversation from an earlier visit, reopened by its id. The chat opens straight on the kept transcript — no welcome screen — and the next message continues it: it goes out on the same thread with the whole history before it.',
          '`chat.threadId` makes the id explicit, so the chat POSTs `/agent/:id/connect` at mount and the Lambda replays what it kept for the signed-in traveller: the transcript, the shared state (the trip plan) and a question the agent was still waiting on.',
          '```tsx\n<AIChat {...props} chat={{ threadId: chatIdFromTheUrl }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return <AIChat {...args} chat={{ ...args.chat, threadId: KEPT_THREAD_ID }} />
  },
}

export const UnknownThread: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "An id the server keeps nothing under — a chat deleted meanwhile, or another traveller's — opens empty and without an error: the connect replays nothing, the same for both, so an id reveals nothing. The first message then starts that conversation under the id.",
      },
    },
  },
  render: (args) => {
    return <AIChat {...args} chat={{ ...args.chat, threadId: 'never-kept' }} />
  },
}
