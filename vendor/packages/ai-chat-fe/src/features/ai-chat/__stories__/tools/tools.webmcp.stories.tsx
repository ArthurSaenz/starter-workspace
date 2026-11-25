import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('tools.webmcp')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Tools and generative UI/WebMCP exposure',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(feature),
}

export default meta
type Story = StoryObj<typeof AIChat>

// `document.modelContext` is the WebMCP entry point; core's registration is a no-op without it,
// so whether this browser has it is the one fact the story can show honestly.
const WebMcpSupport = () => {
  const supported = 'modelContext' in document

  return (
    <p data-testid="webmcp-support" data-supported={supported}>
      document.modelContext in this browser: {supported ? 'present' : 'absent'}
    </p>
  )
}

export const Overview: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: [
          'A frontend tool with `webmcp: true` is also published to browser agents through `document.modelContext`, next to its normal registration with the chat agent. Browsers do not ship that API yet (the line under the card says whether this one does), so there is nothing to see in the chat.',
          "```tsx\n<AIChat provider={{ frontendTools: [{ name: 'showHotelCard', handler, webmcp: true }] }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: () => {
    return (
      <>
        <FeatureCardComponent feature={feature} />
        <WebMcpSupport />
      </>
    )
  },
}
