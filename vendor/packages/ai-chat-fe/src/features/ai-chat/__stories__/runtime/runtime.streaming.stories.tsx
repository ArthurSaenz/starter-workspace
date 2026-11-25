import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Runtime and auth/Streaming replies',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('runtime.streaming'), { parameters: { layout: 'padded' } }),
}

export default meta
type Story = StoryObj<typeof AIChat>

const WORDS = ['Bangkok ', 'for ', 'three ', 'weeks: ', 'plan ', 'on ', 'the ', 'long-stay ', 'rate.']

export const Overview: Story = {
  parameters: {
    // Slow enough to watch the words arrive one by one.
    runtime: { run: { kind: 'streamed', words: WORDS, gapMs: 400 } },
    docs: {
      description: {
        story:
          'The reply appears word by word as the runtime streams it, instead of all at once when it is done. The story opens on a question already sent; type another to watch it again. Nothing to configure — the chat renders streamed replies as they arrive.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="Plan Bangkok" />
      </AIChat>
    )
  },
}
