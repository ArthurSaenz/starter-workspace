import type { CopilotChatAssistantMessage } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { LONG_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Messages/Custom markdown renderer',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('messages.markdownRenderer')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// The smallest possible renderer: the raw text makes "not interpreted as markdown" visible.
const PlainText = (props: ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>) => {
  const { content } = props

  return <pre className="whitespace-pre-wrap">{content}</pre>
}

export const PlainTextRenderer: Story = {
  args: {
    chat: { messageView: { assistantMessage: { markdownRenderer: PlainText } } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'The same long markdown reply as in Markdown (Streamdown), drawn by your own renderer instead — here a plain `<pre>`, so the `#` headings and `|` table rows show as raw text. The renderer gets the assistant message’s `content`.',
          '```tsx\nconst PlainText = ({ content }) => <pre>{content}</pre>\n\n<AIChat chat={{ messageView: { assistantMessage: { markdownRenderer: PlainText } } }} />\n```',
        ].join('\n\n'),
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
