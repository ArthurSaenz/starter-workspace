import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { HostDarkClass, OpenToolsMenu } from '../kit/theming.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Theming and styling/Dark mode',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('theme.dark')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const TOOLS_MENU = [{ label: 'Attach itinerary', action: () => {} }]

export const Dark: Story = {
  args: { theme: { dark: true } },
  parameters: {
    docs: {
      description: {
        story: [
          '`theme.dark: true` switches the chat to CopilotKit’s dark palette: a near-black background, light text, dark bubbles and pills, and a white send button once you type.',
          '```tsx\n<AIChat {...props} theme={{ dark: true }} />\n```',
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

export const DarkPortalBoundary: Story = {
  args: { theme: { dark: true }, chat: { input: { toolsMenu: TOOLS_MENU } } },
  parameters: {
    docs: {
      description: {
        story:
          'Where `theme.dark` stops: the chat is dark, but the open `+` tools menu is still light. The menu is rendered at the end of `<body>`, outside the chat, so the chat’s own dark switch cannot reach it — see `DarkHostClass` for the fix.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SeedTranscript messages={SHORT_EXCHANGE} />
        <OpenToolsMenu />
      </AIChat>
    )
  },
}

export const DarkHostClass: Story = {
  args: { theme: { dark: true }, chat: { input: { toolsMenu: TOOLS_MENU } } },
  parameters: {
    docs: {
      description: {
        story:
          'The same chat with the host’s own dark mode on — `.dark` on `<html>` — so the open `+` tools menu is dark too. Menus and tooltips live outside the chat, so dark mode for them is the host page’s job.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <HostDarkClass />
        <SeedTranscript messages={SHORT_EXCHANGE} />
        <OpenToolsMenu />
      </AIChat>
    )
  },
}
