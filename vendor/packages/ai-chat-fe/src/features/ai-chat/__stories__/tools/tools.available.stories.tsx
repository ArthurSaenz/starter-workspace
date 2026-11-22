import { useAgent } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'

import { TOOL_CALL, scenarios } from '../../__tests__/helpers/index.js'
import type { FakeRuntime } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Tools and generative UI/Tool availability',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('tools.available')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const noop = async () => {
  return undefined
}

interface OfferedToolsProps {
  runtime: FakeRuntime
}

// What the last run offered the agent, read off the fake runtime — the only place the effect of
// `available: false` shows.
const OfferedTools = (props: OfferedToolsProps) => {
  const { runtime } = props

  // Subscribed only to re-render when a reply lands; the run it answers is recorded by then.
  useAgent()

  const lastRun = runtime.runs.at(-1)

  const names =
    lastRun?.body.tools?.map((tool) => {
      return tool.name
    }) ?? []

  return (
    <div className="border-b p-3 text-sm">
      {lastRun ? (
        <>
          Tools offered to the agent: <code>{names.length > 0 ? names.join(', ') : 'none'}</code>
        </>
      ) : (
        'No run yet'
      )}
    </div>
  )
}

export const HiddenFromAgent: Story = {
  args: {
    provider: {
      frontendTools: [
        { name: TOOL_CALL.name, description: 'Show a hotel card for a stay', handler: noop, available: false },
        { name: 'sendItinerary', description: 'Email the itinerary to the traveller', handler: noop },
      ],
    },
  },
  parameters: {
    runtime: scenarios.default,
    docs: {
      description: {
        story: [
          'Keep a tool registered but hide it from the agent. Two tools are registered here and `showHotelCard` has `available: false`, so the line above the chat shows the agent was offered only `sendItinerary`. Flip it back to `true` (the default) and the agent can call it again.',
          "```tsx\n<AIChat provider={{ frontendTools: [{ name: 'showHotelCard', handler, available: false }, sendItinerary] }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args, { loaded }) => {
    return (
      <AIChat {...args}>
        <OfferedTools runtime={runtimeOf(loaded)} />
        <StartRun message="hello" />
      </AIChat>
    )
  },
}
