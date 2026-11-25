import type { Meta, StoryObj } from '@storybook/react'

import { FAKE_THREAD_ID, REASONING_TEXT, REPLY, thinkingFrames } from '../../__tests__/helpers/index.js'
import type { RuntimeScenario } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Messages/Reasoning messages',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('messages.reasoning')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// One frame per flush so the "Thinking…" header is on screen before the thought closes.
const thinkingRun: RuntimeScenario = {
  run: {
    kind: 'paced',
    batches: thinkingFrames(FAKE_THREAD_ID, REASONING_TEXT, REPLY).map((frame) => {
      return [frame]
    }),
    gapMs: 700,
  },
}

export const ThoughtBeforeTheReply: Story = {
  parameters: {
    runtime: thinkingRun,
    docs: {
      description: {
        story: [
          'A model that thinks before it answers: CopilotKit shows "Thinking…" while the `REASONING_*` frames stream, then folds the thought into a collapsed "Thought for …" block above the reply. Click the header to read it.',
          'Nothing to configure — the default `reasoningMessage` renders it. Replace it through `chat.messageView.reasoningMessage`.',
          'The Lambda sends these frames only when `LANGGRAPH_THINKING_BUDGET` is not 0; it is 0 by default.',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="Is a long-stay rate better than the flexible one for 21 nights?" />
      </AIChat>
    )
  },
}
