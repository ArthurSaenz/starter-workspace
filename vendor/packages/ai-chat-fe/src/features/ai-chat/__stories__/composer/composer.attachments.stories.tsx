import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { QueueFiles } from '../kit/composer.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Composer/Attachments',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('composer.attachments'), {
    parameters: { runtime: scenarios.attachments },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

// Story args, not meta args: `args` in `defineFeatureMeta`'s extra would replace the preset args.
const ATTACHMENTS_ON = { chat: { attachments: { enabled: true, onUploadFailed: fn() } } }

const ITINERARY = [new File(['Day 1: Bangkok. Day 2: Ayutthaya.'], 'itinerary.txt', { type: 'text/plain' })]

export const Enabled: Story = {
  args: ATTACHMENTS_ON,
  parameters: {
    docs: {
      description: {
        story: [
          'Attachments turned on: the "+" button next to the input is enabled and opens the file picker (by default it is shown but disabled). `accept` limits the file types; a rejected file never reaches the queue and `onUploadFailed` is called instead.',
          '```tsx\n<AIChat chat={{ attachments: { enabled: true, accept: "text/plain", onUploadFailed } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}

export const FileQueued: Story = {
  args: ATTACHMENTS_ON,
  parameters: {
    docs: {
      description: {
        story:
          'A file picked and waiting above the input. Type a message and send: the file goes with it as a document part of the message. Our backend reads text only and refuses bodies over 512 KB, so large or binary files do not reach the model yet.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <QueueFiles files={ITINERARY} />
      </AIChat>
    )
  },
}
