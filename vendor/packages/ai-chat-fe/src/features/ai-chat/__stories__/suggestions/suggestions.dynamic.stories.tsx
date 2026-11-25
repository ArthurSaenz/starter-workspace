import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Suggestions/Agent-generated pills',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('suggestions.dynamic')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const GeneratedAfterAnswer: Story = {
  args: {
    features: {
      ...NOMADREAM_PRESET.features,
      dynamicSuggestions: { instructions: 'Suggest what a long-stay traveller in Bangkok could ask next.' },
    },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'After each answer the agent writes the next questions itself, and they replace the fixed pills — here the ones under the first reply. Clicking one asks it. Each answer costs one extra model call.',
          "```tsx\n<AIChat {...props} features={{ dynamicSuggestions: { instructions: 'Suggest what a long-stay traveller could ask next.' } }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="hello" />
      </AIChat>
    )
  },
}
