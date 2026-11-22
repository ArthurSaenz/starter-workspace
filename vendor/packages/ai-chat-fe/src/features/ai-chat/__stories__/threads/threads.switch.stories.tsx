import { useCopilotChatConfiguration } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Threads/Switch or new thread',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('threads.switch')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// The hook resolves to the package's configuration provider, so the button drives the same thread
// `CopilotChat` runs against.
const NewThreadButton = () => {
  const configuration = useCopilotChatConfiguration()

  return (
    <button
      type="button"
      className="m-2 self-start rounded border px-2 py-1 text-sm"
      onClick={() => {
        configuration?.startNewThread()
      }}
    >
      New thread
    </button>
  )
}

export const ConversationWithNewThreadButton: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'A finished exchange with a "New thread" button above it. Click it: the transcript empties, the welcome screen is back, and the next message starts a fresh conversation with its own thread id — no history carries over.',
          'Switching back to an earlier thread is `setActiveThreadId(id)`: an explicit thread, which the chat restores from the server through `/connect` (see Explicit threadId and Thread list).',
          '```tsx\nconst NewThreadButton = () => {\n  const configuration = useCopilotChatConfiguration()\n\n  return <button onClick={() => configuration?.startNewThread()}>New thread</button>\n}\n\n<AIChat {...props}>\n  <NewThreadButton />\n</AIChat>\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <NewThreadButton />
        <SeedTranscript messages={SHORT_EXCHANGE} />
      </AIChat>
    )
  },
}
