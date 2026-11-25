import type { Meta, StoryObj } from '@storybook/react'
import type { ReactElement } from 'react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Surfaces and copy/Welcome screen',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('copy.welcome')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const PRESET_FEATURES = NOMADREAM_PRESET.features

// A replacement screen still gets the bound `input` and `suggestionView` elements to place.
interface StoryWelcomeProps {
  input: ReactElement
  suggestionView: ReactElement
}

const StoryWelcome = (props: StoryWelcomeProps) => {
  const { input, suggestionView } = props

  return (
    <div data-testid="story-welcome">
      <h2>Ada, where to next?</h2>
      {input}
      {suggestionView}
    </div>
  )
}

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The preset: a new thread opens on CopilotKit’s welcome screen with the NomaDream greeting, the input and the suggestion pills. It goes away once the thread has its first message.',
      },
    },
  },
}

export const Off: Story = {
  args: {
    features: { ...PRESET_FEATURES, welcome: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`features.welcome: false` — a new thread shows the plain chat layout: no greeting, just the input with the pills above it.',
      },
    },
  },
}

export const CustomComponent: Story = {
  args: {
    features: { ...PRESET_FEATURES, welcome: StoryWelcome },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`features.welcome` set to your own component. It replaces CopilotKit’s screen and receives the ready `input` and `suggestionView` elements to place wherever it wants.',
      },
    },
  },
}
