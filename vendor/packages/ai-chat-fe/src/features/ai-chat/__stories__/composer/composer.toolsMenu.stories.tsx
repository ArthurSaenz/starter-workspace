import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { OpenToolsMenu } from '../kit/composer.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Composer/Tools menu',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('composer.toolsMenu')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const MenuOpen: Story = {
  args: {
    chat: { input: { toolsMenu: [{ label: 'Compare programmes', action: fn() }] } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'A menu behind the "+" button next to the input, shown open here with one item, "Compare programmes". Picking an item calls its `action` (see the Actions panel) and closes the menu. Without `toolsMenu` (and without attachments) the "+" button is shown but disabled.',
          '```tsx\n<AIChat chat={{ input: { toolsMenu: [{ label: "Compare programmes", action: compare }] } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <OpenToolsMenu />
      </AIChat>
    )
  },
}
