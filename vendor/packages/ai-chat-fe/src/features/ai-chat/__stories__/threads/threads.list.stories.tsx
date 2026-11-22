import { useCopilotChatConfiguration, useThreads } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import type { KeptThread } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { LONG_EXCHANGE, SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Threads/Thread list',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('threads.list')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const KEPT_THREADS: KeptThread[] = [
  {
    id: 'kept-bangkok',
    name: 'three weeks in Bangkok',
    messages: LONG_EXCHANGE,
    updatedAt: '2026-10-02T09:00:00.000Z',
  },
  { id: 'kept-hello', name: 'hello', messages: SHORT_EXCHANGE, updatedAt: '2026-10-01T09:00:00.000Z' },
]

// The hook resolves to the package's configuration provider: a picked row becomes the chat's explicit
// thread, which the chat restores through `/connect`.
const ThreadList = () => {
  const { threads, listError } = useThreads({ agentId: 'travelAiAgent' })
  const configuration = useCopilotChatConfiguration()

  return (
    <nav className="flex flex-wrap gap-2 border-b p-2 text-sm" aria-label="Kept conversations">
      {threads.map((thread) => {
        return (
          <button
            key={thread.id}
            type="button"
            data-testid="thread-row"
            aria-current={configuration?.threadId === thread.id}
            className="rounded border px-2 py-1 aria-[current=true]:font-semibold"
            onClick={() => {
              configuration?.setActiveThreadId(thread.id)
            }}
          >
            {thread.name ?? thread.id}
          </button>
        )
      })}
      {listError ? <p data-testid="threads-error">{listError.message}</p> : null}
    </nav>
  )
}

export const KeptConversations: Story = {
  parameters: {
    runtime: { ...scenarios.default, threads: KEPT_THREADS },
    docs: {
      description: {
        story: [
          'The traveller’s earlier conversations, newest first, above a fresh chat. Pick one and the chat reopens it: the transcript comes back and the next message continues it.',
          '`useThreads({ agentId })` in `children` reads `GET /threads`, which the Lambda answers from the signed-in traveller’s kept chats only. A row calls `useCopilotChatConfiguration().setActiveThreadId(id)`, an explicit thread, so the chat restores it through `/connect`.',
          'Caveat: the list is read-only here. `useThreads`’ `renameThread`, `archiveThread` and `deleteThread` are CopilotKit Intelligence and answer 422; the client app deletes a chat through its own API.',
          "```tsx\nconst ThreadList = () => {\n  const { threads } = useThreads({ agentId: 'travelAiAgent' })\n  const configuration = useCopilotChatConfiguration()\n\n  return threads.map((thread) => (\n    <button key={thread.id} onClick={() => configuration?.setActiveThreadId(thread.id)}>{thread.name}</button>\n  ))\n}\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <ThreadList />
      </AIChat>
    )
  },
}
