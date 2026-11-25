import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Programmatic run',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('control.programmatic')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const PROMPT = 'Plan a three-week stay in Bangkok for me.'

// Exactly what CopilotChat's composer does on Enter, from a consumer's button: add the user message
// to the chat's agent, then ask the core to run it.
const PlanButton = () => {
  const { agent } = useAgent()
  const { copilotkit } = useCopilotKit()

  return (
    <div className="border-b p-3">
      <button
        type="button"
        className="rounded border px-2 py-1 text-sm"
        onClick={() => {
          agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: PROMPT })
          void copilotkit.runAgent({ agent })
        }}
      >
        Plan my stay
      </button>
    </div>
  )
}

export const ButtonOutsideChatRuns: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'A button of your own, outside the composer, that asks the assistant something — a "Plan my stay" call to action on a hotel page, say. Click it: "Plan a three-week stay in Bangkok for me." appears as the traveller’s message and the answer follows, without typing.',
          "```tsx\nconst PlanButton = () => {\n  const { agent } = useAgent()\n  const { copilotkit } = useCopilotKit()\n\n  const plan = () => {\n    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: 'Plan a three-week stay in Bangkok for me.' })\n    void copilotkit.runAgent({ agent })\n  }\n\n  return <button onClick={plan}>Plan my stay</button>\n}\n\n<AIChat {...props}>\n  <PlanButton />\n</AIChat>\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <PlanButton />
      </AIChat>
    )
  },
}
