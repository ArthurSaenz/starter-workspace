import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import { AIChatContainer } from '../../containers/ai-chat-container.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AIChatContainerProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChatContainer> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Surfaces and copy/Disclaimer',
  tags: ['autodocs', 'status:on'],
  // The client surface itself, not the preset through `AIChat`: what apps/client ships.
  ...defineFeatureMeta<AIChatContainerProps>(featureById('copy.disclaimer'), {
    component: AIChatContainer,
    args: { preset: NOMADREAM_PRESET, userName: 'Ada' },
  }),
}

export default meta
type Story = StoryObj<typeof AIChatContainer>

const StoryDisclaimer = () => {
  return <p>Check the numbers.</p>
}

const DISCLAIMER_TEXT = 'Numbers are estimates — check them before you book.'
const ADA_CONTEXT = [{ description: 'Name of the signed-in traveller', value: 'Ada' }]

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'The product default: the preset sets `features.disclaimer: false`, so nothing renders under the input.',
      },
    },
  },
}

export const Off: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`features.disclaimer: false` — nothing renders under the input, not even CopilotKit’s own “AI can make mistakes” line.',
      },
    },
  },
  // `AIChatContainer` has no `features` prop — the seam lives on `AIChat`, as in `Text`.
  render: () => {
    return (
      <AIChat
        {...NOMADREAM_PRESET}
        context={ADA_CONTEXT}
        features={{ ...NOMADREAM_PRESET.features, disclaimer: false }}
      />
    )
  },
}

export const Text: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`features.disclaimer: "Numbers are estimates — check them before you book."` — a string turns the line back on with that text.',
      },
    },
  },
  // `AIChatContainer` has no `features` prop — the string seam lives on `AIChat`, so this story
  // renders the preset through it directly and ignores the container args.
  render: () => {
    return (
      <AIChat
        {...NOMADREAM_PRESET}
        context={ADA_CONTEXT}
        features={{ ...NOMADREAM_PRESET.features, disclaimer: DISCLAIMER_TEXT }}
      />
    )
  },
}

export const WithDisclaimerOverride: Story = {
  args: {
    chat: { input: { disclaimer: StoryDisclaimer } },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`chat={{ input: { disclaimer: Component } }}` — your own component under the input. The rest of the preset (greeting, placeholder) stays.',
      },
    },
  },
}
