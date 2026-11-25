import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { OpenToolsMenu } from '../kit/theming.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Theming and styling/Design tokens',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('theme.tokens')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const BRAND_BACKGROUND = 'rgb(255, 244, 214)'
const BRAND_FOREGROUND = 'rgb(64, 32, 0)'
const BRAND_POPOVER = 'rgb(214, 236, 255)'

const TOOLS_MENU = [{ label: 'Attach itinerary', action: () => {} }]

const PORTAL_ARGS = {
  theme: { tokens: { background: BRAND_BACKGROUND, popover: BRAND_POPOVER } },
  chat: { input: { toolsMenu: TOOLS_MENU } },
}

export const BrandTokens: Story = {
  args: { theme: { tokens: { background: BRAND_BACKGROUND, foreground: BRAND_FOREGROUND } } },
  parameters: {
    docs: {
      description: {
        story: [
          'Two of CopilotKit’s colour tokens set through `theme.tokens`: the chat background turns cream and the pills take dark-brown text. Only the tokens you set change; the send button and input stay as CopilotKit draws them because they do not read tokens.',
          "```tsx\n<AIChat {...props} theme={{ tokens: { background: 'rgb(255, 244, 214)', foreground: 'rgb(64, 32, 0)' } }} />\n```",
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

export const PortalBoundary: Story = {
  args: PORTAL_ARGS,
  parameters: {
    docs: {
      description: {
        story:
          "Where the default `scope: 'chat'` stops: `background` and `popover` are set, the chat is cream, but the open `+` tools menu is still white, not blue. The menu is rendered at the end of `<body>`, outside the chat, so tokens scoped to this chat do not reach it — see `HostScope`.",
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

export const HostScope: Story = {
  args: { ...PORTAL_ARGS, theme: { ...PORTAL_ARGS.theme, scope: 'host' } },
  parameters: {
    docs: {
      description: {
        story: [
          "The same tokens with `theme.scope: 'host'`: they apply to every CopilotKit element on the page, so the open tools menu is blue as well. The cost is in the name — any other CopilotKit chat on the page is re-coloured too.",
          "```tsx\n<AIChat {...props} theme={{ tokens: { popover: 'rgb(214, 236, 255)' }, scope: 'host' }} />\n```",
        ].join('\n\n'),
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
