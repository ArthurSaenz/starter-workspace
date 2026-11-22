import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Open Generative UI',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('genui.openGenerativeUI')),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const SandboxedStay: Story = {
  parameters: {
    runtime: scenarios.openGenerativeUi,
    // The Lambda never sends either: the stand-in does, so the browser half is on show.
    catalogue: { fakeSupplies: ['/info openGenerativeUIEnabled: true', 'open-generative-ui activity frames'] },
    docs: {
      description: {
        story: [
          'The model writes HTML and CSS, and the chat runs it in a sandboxed iframe inside the reply. Here the stand-in runtime reports `openGenerativeUIEnabled: true` and streams what CopilotKit’s built-in middleware would: the `generateSandboxedUi` call the browser registered, then the `open-generative-ui` activity filling in css, html and `generating: false`. The browser answers the call and the agent replies once more.',
          'Off in the product by decision: the Lambda never enables it (model-written HTML), and no preset passes the prop — passing it at all switches the browser half on, whatever `/info` says.',
          '```tsx\n<AIChat {...props} provider={{ openGenerativeUI: { designSkill: "…" } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message="Sketch my 21 nights in Bangkok" />
      </AIChat>
    )
  },
}
