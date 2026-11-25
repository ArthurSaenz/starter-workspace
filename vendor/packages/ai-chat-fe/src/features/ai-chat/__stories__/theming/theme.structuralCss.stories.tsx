import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Theming and styling/Structural chrome',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('theme.structuralCss')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const StructuralCss: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'The chat fills the box it is given — here the 600px story frame — with the conversation scrolling and the input pinned to the bottom, without any Tailwind class. That layout comes from the package stylesheet, which the host imports once:',
          "```tsx\nimport '@wl/ai-chat-fe/styles.css'\n```",
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
