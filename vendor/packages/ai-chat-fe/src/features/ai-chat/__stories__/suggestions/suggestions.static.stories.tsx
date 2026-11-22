import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET, scenarios } from '../../__tests__/helpers/index.js'
import { AIChatContainer } from '../../containers/ai-chat-container.js'
import type { AIChatContainerProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChatContainer> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Suggestions/Static pills',
  tags: ['autodocs', 'status:on'],
  // The client surface itself, not the preset through `AIChat`: this is what apps/client ships.
  ...defineFeatureMeta<AIChatContainerProps>(featureById('suggestions.static'), {
    component: AIChatContainer,
    args: { preset: NOMADREAM_PRESET, userName: 'Ada' },
  }),
}

export default meta
type Story = StoryObj<typeof AIChatContainer>

const PLAN_LONG_STAY = 'I am planning a 3-week stay in Lisbon. How should I think about the total cost?'

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'The chat apps/client ships, on a new thread: the welcome text and three fixed pills — “Plan a long stay”, “Compare programmes”, “Elite status”. Each pill has a short title and the full question it sends.',
          "```tsx\n<AIChat {...props} features={{ suggestions: [{ title: 'Plan a long stay', message: 'I am planning a 3-week stay…' }] }} />\n```",
        ].join('\n\n'),
      },
    },
  },
}

export const AfterPillClick: Story = {
  parameters: {
    runtime: scenarios.suggestionClick,
    docs: {
      description: {
        story:
          'After “Plan a long stay” was clicked: the pill’s full question is the traveller’s message, the reply follows, and the pills are gone for the rest of the thread.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChatContainer {...args}>
        <StartRun message={PLAN_LONG_STAY} />
      </AIChatContainer>
    )
  },
}
