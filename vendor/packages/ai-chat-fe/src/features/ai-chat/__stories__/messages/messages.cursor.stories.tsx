import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Messages/Loading cursor',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('messages.cursor'), {
    // The run never answers, so the waiting state stays on screen.
    parameters: { runtime: scenarios.thinking },
    render: (args) => {
      return (
        <AIChat {...args}>
          <StartRun message="hello" />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

const RatesCursor = () => {
  return <p role="status">Checking the rates…</p>
}

export const Thinking: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'On by default. While the assistant is working, a pulsing dot shows under the traveller’s message and the send button turns into a square stop button. The input stays usable.',
      },
    },
  },
}

export const CustomCursor: Story = {
  args: {
    chat: { messageView: { cursor: RatesCursor } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Your own waiting indicator in place of the pulsing dot — here a "Checking the rates…" line.',
          '```tsx\n<AIChat chat={{ messageView: { cursor: RatesCursor } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
