import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Surfaces and copy/Sidebar',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('surface.sidebar')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Closed: Story = {
  args: {
    // CopilotKit's own `defaultOpen` is `true`; a launcher that starts closed has to say so.
    surface: { kind: 'sidebar', defaultOpen: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`surface: { kind: "sidebar", defaultOpen: false }` — only the round launcher button shows. Click it to slide the panel in; click again to hide it.',
      },
    },
  },
}

export const Open: Story = {
  args: {
    surface: { kind: 'sidebar', defaultOpen: true, position: 'left' },
    // The preset sets no `modalHeaderTitle` (inline has no header), so without the label the panel
    // would be titled "CopilotKit Chat".
    chat: { labels: { ...NOMADREAM_PRESET.chat.labels, modalHeaderTitle: 'NomaDream assistant' } },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`surface: { kind: "sidebar", defaultOpen: true, position: "left" }` with a conversation in it. The panel is docked left and titled through `chat.labels.modalHeaderTitle`; its close button hides it.',
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
