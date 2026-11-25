import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Messages/Message slots',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('messages.assistantSlots'), {
    render: (args) => {
      return (
        <AIChat {...args}>
          <SeedTranscript messages={SHORT_EXCHANGE} />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

const onSave = fn()

const SaveButton = () => {
  return (
    <button type="button" onClick={onSave}>
      Save to trip
    </button>
  )
}

export const ExtraToolbarItem: Story = {
  args: {
    chat: { messageView: { assistantMessage: { additionalToolbarItems: <SaveButton /> } } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Your own buttons in the assistant toolbar: a "Save to trip" button sits under the reply, after the built-in copy button. `messageView.userMessage` takes the same keys for the traveller’s bubble.',
          '```tsx\n<AIChat chat={{ messageView: { assistantMessage: { additionalToolbarItems: <SaveButton /> } } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}

export const ToolbarHidden: Story = {
  args: {
    chat: { messageView: { assistantMessage: { toolbarVisible: false } } },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`chat.messageView: { assistantMessage: { toolbarVisible: false } }` removes the toolbar under the reply altogether — no copy button, no extra items. The traveller’s bubble keeps its own.',
      },
    },
  },
}
