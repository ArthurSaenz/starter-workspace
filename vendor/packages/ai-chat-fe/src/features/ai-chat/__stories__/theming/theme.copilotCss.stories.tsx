import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Theming and styling/CopilotKit stylesheet',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('theme.copilotCss')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Overview: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'The chat as CopilotKit styles it: grey rounded user bubbles, plain assistant text, round pills and the rounded input. The package imports `@copilotkit/react-core/v2/styles.css` for you, which brings CopilotKit’s colour tokens and its `cpk:*` classes.',
          'If your bundler drops CSS side-effect imports, import it yourself once:',
          "```tsx\nimport '@copilotkit/react-core/v2/styles.css'\n```",
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
