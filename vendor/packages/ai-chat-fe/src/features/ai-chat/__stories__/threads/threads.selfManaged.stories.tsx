import { useCopilotChatConfiguration } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Threads/Self-managed persistence',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('threads.selfManaged')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface ThreadIdReporterProps {
  onThreadId: (threadId: string) => void
}

const ThreadIdReporter = (props: ThreadIdReporterProps) => {
  const { onThreadId } = props

  const threadId = useCopilotChatConfiguration()?.threadId

  useEffect(() => {
    if (threadId) onThreadId(threadId)
  }, [onThreadId, threadId])

  return null
}

// A remount drops everything the browser held; only the server's copy can bring the chat back.
const ReopenableChat = (args: AiChatProps) => {
  const [threadId, setThreadId] = useState<string>()
  const [reopened, setReopened] = useState<string>()

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        className="m-2 self-start rounded border px-2 py-1 text-sm"
        disabled={!threadId}
        onClick={() => {
          setReopened(threadId)
        }}
      >
        Close and reopen this conversation
      </button>
      <div className="min-h-0 flex-1">
        <AIChat key={reopened ?? 'fresh'} {...args} chat={reopened ? { ...args.chat, threadId: reopened } : args.chat}>
          <ThreadIdReporter onThreadId={setThreadId} />
        </AIChat>
      </div>
    </div>
  )
}

export const ReopenAfterRemount: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Send a message, wait for the answer, then close and reopen the conversation: the chat mounts from scratch — nothing kept in the browser — and the conversation comes back from the server.',
          'Nothing in the package does this. The Lambda’s `AgentRunner` (`CustomerChatsRunner`) writes every finished run to the traveller’s kept chats and replays one on `/connect`; the reopened chat only names the thread (`chat.threadId`).',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return <ReopenableChat {...args} />
  },
}
