import type { Meta, StoryObj } from '@storybook/react'

import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Composer/Auto-focus',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('composer.autoFocus')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const FocusedOnMount: Story = {
  args: {
    chat: { input: { autoFocus: true } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'The input has the focus as soon as the chat opens — start typing without clicking it. Off by default: the focus stays where the page left it.',
          '```tsx\n<AIChat chat={{ input: { autoFocus: true } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
