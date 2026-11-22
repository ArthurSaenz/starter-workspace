import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { LONG_EXCHANGE, exchange } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Messages/Markdown (Streamdown)',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('messages.markdown')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const MarkdownReply: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'On by default. A long reply rendered as markdown: headings, a numbered list, a table, a highlighted code block with its own copy button, and a quote. The transcript scrolls.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SeedTranscript messages={LONG_EXCHANGE} />
      </AIChat>
    )
  },
}

// A prompt-injected image and a plain-http link, next to the two links that survive.
const INJECTED_REPLY = [
  'Here is your plan ![](https://evil.example/x?d=1)',
  '[Park Hyatt Bangkok](https://www.hyatt.com/park-hyatt) · [Write to us](mailto:hi@nomadream.ai) · [Tracker](http://evil.example/t)',
].join('\n\n')

export const HardenedImagesAndLinks: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A reply carrying an image and an `http:` link, as a prompt-injected web page could make the model write. The image never renders, so nothing is fetched; the `https:` and `mailto:` links stay links and the `http:` one is plain text.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SeedTranscript messages={exchange('plan my stay', INJECTED_REPLY)} />
      </AIChat>
    )
  },
}
