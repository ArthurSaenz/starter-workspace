import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Theming and styling/Tailwind utilities',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('theme.utilities')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const UtilitiesRender: Story = {
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story: [
          'The package’s own pieces — here the red, centred error line under the input after a failed turn — are styled with Tailwind classes that the host’s Tailwind build generates. The host points Tailwind at the package once:',
          "```css\n/* the host's Tailwind entry, e.g. apps/client/ui/src/styles/globals.css */\n@source '../../../../../vendor/packages/ai-chat-fe/src';\n```",
          'Without that line the error still shows, but in plain inherited text.',
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
