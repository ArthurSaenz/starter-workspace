import { useCopilotChatConfiguration } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Threads/Auto thread id',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('threads.mint')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const ThreadIdBadge = () => {
  const configuration = useCopilotChatConfiguration()

  return (
    <p className="border-b p-3 text-sm">
      Thread <code>{configuration?.threadId}</code>
    </p>
  )
}

// A key flip is the only way to remount `<AIChat>` from inside a story; `args` still reach the
// chat unchanged.
const RemountableChat = (args: AiChatProps) => {
  const [mount, setMount] = useState(0)

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        className="m-2 self-start rounded border px-2 py-1 text-sm"
        onClick={() => {
          setMount((previous) => {
            return previous + 1
          })
        }}
      >
        Remount
      </button>
      <div className="min-h-0 flex-1">
        <AIChat key={mount} {...args}>
          <ThreadIdBadge />
        </AIChat>
      </div>
    </div>
  )
}

export const FreshIdPerMount: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'No `chat.threadId` needed: the chat mints a thread id (a UUID) when it mounts and every message in that mount belongs to the same conversation. The badge shows the id; "Remount" starts over with a new id and an empty transcript.',
          'A component in `children` reads the id from `useCopilotChatConfiguration().threadId`.',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return <RemountableChat {...args} />
  },
}
