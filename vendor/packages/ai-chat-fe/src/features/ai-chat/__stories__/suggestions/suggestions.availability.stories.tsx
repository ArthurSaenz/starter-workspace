import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Suggestions/Availability',
  tags: ['autodocs', 'status:on'],
  // Every state here is "after the first reply" — the moment the three settings differ.
  ...defineFeatureMeta(featureById('suggestions.availability'), {
    render: (args) => {
      return (
        <AIChat {...args}>
          <StartRun message="hello" />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

const PILLS = NOMADREAM_PRESET.features.suggestions
const PRESET_FEATURES = NOMADREAM_PRESET.features

export const Always: Story = {
  args: {
    features: { ...PRESET_FEATURES, suggestions: { items: PILLS, available: 'always' } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          "`available: 'always'`: the pills show on the empty thread and come back under every reply — here under the first one.",
          "```tsx\n<AIChat {...props} features={{ suggestions: { items, available: 'always' } }} />\n```",
        ].join('\n\n'),
      },
    },
  },
}

export const AfterFirstMessage: Story = {
  args: {
    features: { ...PRESET_FEATURES, suggestions: { items: PILLS, available: 'after-first-message' } },
  },
  parameters: {
    docs: {
      description: {
        story:
          "`available: 'after-first-message'`: the empty thread has no pills; they appear under the first reply, as here. The preset’s own setting, `before-first-message`, is the opposite: pills on the empty thread only.",
      },
    },
  },
}

export const Disabled: Story = {
  args: {
    features: { ...PRESET_FEATURES, suggestions: { items: PILLS, available: 'disabled' } },
  },
  parameters: {
    docs: {
      description: {
        story:
          "`available: 'disabled'`: the pills are configured but never shown — not on the empty thread, not after a reply. The chat works as usual.",
      },
    },
  },
}
