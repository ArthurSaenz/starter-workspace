import { useAgent, useCapabilities } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Context and state/Capabilities',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('state.capabilities')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const yesNo = (value: boolean | undefined) => {
  return value ? 'yes' : 'no'
}

// Gated on `isReady`: before `/info` lands the hook reads a placeholder agent with no capabilities.
const AgentCapabilitiesPanel = () => {
  const { isReady } = useAgent({ updates: [] })
  const capabilities = useCapabilities()

  if (!isReady || !capabilities) return <p className="border-b p-3 text-sm text-gray-500">Connecting…</p>

  return (
    <ul className="space-y-0.5 border-b bg-slate-50 p-3 text-sm">
      <li className="font-semibold">{capabilities.identity?.description ?? capabilities.identity?.name}</li>
      <li>Streams replies: {yesNo(capabilities.transport?.streaming)}</li>
      <li>Uses tools: {yesNo(capabilities.tools?.supported)}</li>
      <li>Shows its thinking: {yesNo(capabilities.reasoning?.supported)}</li>
      <li>Asks before acting: {yesNo(capabilities.humanInTheLoop?.approvals)}</li>
    </ul>
  )
}

export const CapabilitiesPanel: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'What the agent says it can do, read once the chat connects — here a panel above the chat. Use it to show or hide UI the agent cannot drive (a thinking toggle, an approval flow).',
          '`useCapabilities()` returns `GET /info` `agents[agentId].capabilities`, or `undefined` until it lands.',
          '```tsx\nconst capabilities = useCapabilities()\n\n<AIChat {...props}>\n  <AgentCapabilitiesPanel />\n</AIChat>\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <AgentCapabilitiesPanel />
      </AIChat>
    )
  },
}
