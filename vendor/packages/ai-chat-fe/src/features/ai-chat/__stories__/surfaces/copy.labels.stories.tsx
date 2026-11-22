import type { Meta, StoryObj } from '@storybook/react'

import { NOMADREAM_PRESET } from '../../__tests__/helpers/index.js'
import { AIChatContainer } from '../../containers/ai-chat-container.js'
import type { AIChatContainerProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChatContainer> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Surfaces and copy/Labels',
  tags: ['autodocs', 'status:on'],
  // The container, not the preset through `AIChat`: `chat.labels` is deep-merged over the preset's
  // resolved `chat` here.
  ...defineFeatureMeta<AIChatContainerProps>(featureById('copy.labels'), {
    component: AIChatContainer,
    args: { preset: NOMADREAM_PRESET, userName: 'Ada' },
  }),
}

export default meta
type Story = StoryObj<typeof AIChatContainer>

export const CustomPlaceholder: Story = {
  args: {
    chat: { labels: { chatInputPlaceholder: 'Where to next, Ada?' } },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`chat={{ labels: { chatInputPlaceholder } }}` re-words one label. The other labels keep the preset text: `labels` merge key by key, so the welcome greeting is still the NomaDream one.',
      },
    },
  },
}

export const CustomWelcomeAndPlaceholder: Story = {
  args: {
    chat: {
      labels: {
        welcomeMessageText: 'Ada, where are you headed next?',
        chatInputPlaceholder: 'Hotels, points, routes…',
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Several labels at once — here the welcome greeting and the input placeholder. Every visible string in the chat is a key of `chat.labels` (44 keys from `CopilotChatDefaultLabels`).',
      },
    },
  },
}
