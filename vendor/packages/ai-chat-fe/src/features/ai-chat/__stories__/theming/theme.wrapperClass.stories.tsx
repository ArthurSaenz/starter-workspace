import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Theming and styling/Host class hook',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('theme.wrapperClass')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const BoundedHeight: Story = {
  args: { className: 'max-h-80 border-4 border-dashed' },
  parameters: {
    docs: {
      description: {
        story: [
          '`className` goes on the chat’s outer box, so the host controls its layout from outside. Here a dashed border shows the box and `max-h-80` caps it at 320px inside the 600px frame — the chat shrinks with it and keeps its input at the bottom.',
          '```tsx\n<AIChat {...props} className="max-h-80 border-4 border-dashed" />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SeedTranscript messages={SHORT_EXCHANGE} />
      </AIChat>
    )
  },
}
