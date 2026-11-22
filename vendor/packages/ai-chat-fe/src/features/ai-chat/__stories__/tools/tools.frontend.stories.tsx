import type { Meta, StoryObj } from '@storybook/react'

import { ShowHotelCard } from '../../__tests__/helpers/demo-tools.js'
import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Frontend tool',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('tools.frontend')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const HotelCard: Story = {
  parameters: {
    runtime: scenarios.toolCall,
    docs: {
      description: {
        story: [
          'A tool that runs in the browser. The agent called `showHotelCard`, and the card it draws — "Mandarin Oriental Bangkok · 21 nights · complete" — sits inside the assistant’s reply. The product ships no frontend tool yet; this one is a demo.',
          'Register it with `useFrontendTool` in `<AIChat>`’s `children`, or declaratively on `provider.frontendTools`; either way the tool is offered to the agent on every run.',
          "```tsx\nconst ShowHotelCard = () => {\n  useFrontendTool({ name: 'showHotelCard', description, handler, render: HotelCard })\n  return null\n}\n\n<AIChat {...props}>\n  <ShowHotelCard />\n</AIChat>\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <ShowHotelCard />
        <StartRun message="show me the Mandarin" />
      </AIChat>
    )
  },
}
