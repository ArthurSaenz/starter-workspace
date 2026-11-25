import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Surfaces and copy/Popup',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('surface.popup')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// The preset sets no `modalHeaderTitle` (inline has no header), so without the label the window
// would be titled "CopilotKit Chat".
const TITLED = { labels: { ...NOMADREAM_PRESET.chat.labels, modalHeaderTitle: 'NomaDream assistant' } }

export const Closed: Story = {
  args: {
    // CopilotKit's own `defaultOpen` is `true`; a launcher that starts closed has to say so.
    surface: { kind: 'popup', defaultOpen: false },
    chat: TITLED,
  },
  parameters: {
    docs: {
      description: {
        story:
          '`surface: { kind: "popup", defaultOpen: false }` — only the floating launcher button shows. Click it to open the chat window.',
      },
    },
  },
}

export const Open: Story = {
  args: {
    surface: { kind: 'popup', defaultOpen: true, clickOutsideToClose: true },
    chat: TITLED,
  },
  parameters: {
    docs: {
      description: {
        story:
          '`surface: { kind: "popup", defaultOpen: true, clickOutsideToClose: true }` with a conversation in it, titled through `chat.labels.modalHeaderTitle`. A click anywhere outside the window closes it; without `clickOutsideToClose` only the close button does.',
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
