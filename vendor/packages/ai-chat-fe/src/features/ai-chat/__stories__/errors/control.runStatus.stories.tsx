import { UseAgentUpdate, useAgent } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Errors and observability/Run status',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('control.runStatus')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// The same subscription the package's own RunStatusWatcher uses to retire the error line, from a
// consumer's seat.
const RunStatusBadge = () => {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnRunStatusChanged] })
  const [runsStarted, setRunsStarted] = useState(0)
  const [seenRunning, setSeenRunning] = useState(false)

  const isRunning = agent.isRunning

  // Counted on the flag's rising edge (React's adjust-state-while-rendering pattern), not on the
  // agent's run-started event: that waits for the runtime's first frame, so a turn still waiting on
  // it would read "running · runs started: 0".
  if (isRunning !== seenRunning) {
    setSeenRunning(isRunning)

    if (isRunning) {
      setRunsStarted((count) => {
        return count + 1
      })
    }
  }

  return (
    <p className="border-b p-3 text-sm">
      {isRunning ? 'running' : 'idle'} · runs started: {runsStarted}
    </p>
  )
}

const USAGE =
  "```tsx\nconst RunStatusBadge = () => {\n  const { agent } = useAgent({ updates: [UseAgentUpdate.OnRunStatusChanged] })\n\n  return <p>{agent.isRunning ? 'running' : 'idle'}</p>\n}\n\n<AIChat {...props}>\n  <RunStatusBadge />\n</AIChat>\n```"

export const Idle: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Your own component in `<AIChat>`’s `children` can follow the run: `useAgent({ updates: [UseAgentUpdate.OnRunStatusChanged] })` re-renders it whenever a turn starts or ends. Nothing has been asked yet, so the badge above the chat reads "idle · runs started: 0".',
          USAGE,
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <RunStatusBadge />
      </AIChat>
    )
  },
}

export const Running: Story = {
  parameters: {
    runtime: scenarios.thinking,
    docs: {
      description: {
        story:
          'A turn is under way and the assistant has not answered yet: the badge reads "running · runs started: 1".',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <RunStatusBadge />
        <StartRun message="hello" />
      </AIChat>
    )
  },
}

export const Failed: Story = {
  parameters: {
    runtime: scenarios.runErrorThenRetry,
    docs: {
      description: {
        story:
          'The turn failed: "idle · runs started: 1" and the error line under the input. Type another message — the badge flips to "running", and that same flip is what clears the error line; the answer arrives with "idle · runs started: 2".',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <RunStatusBadge />
        <StartRun message="hello" />
      </AIChat>
    )
  },
}
