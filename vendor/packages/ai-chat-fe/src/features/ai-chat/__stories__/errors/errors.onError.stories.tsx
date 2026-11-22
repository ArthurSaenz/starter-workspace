import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatProps, ChatFailure, ChatFailureEvent } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Errors and observability/Error events',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('errors.onError')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const QUESTION = 'Is a three-week stay in Bangkok worth it with Marriott status?'

const failedTurn: Story['render'] = (args) => {
  return (
    <AIChat {...args}>
      <StartRun message={QUESTION} />
    </AIChat>
  )
}

export const RunError: Story = {
  parameters: {
    runtime: scenarios.runErrorThenRetry,
    docs: {
      description: {
        story:
          'The assistant hit an error while answering: the question stays, no answer, and the line under the input carries the Lambda’s own sentence — "The assistant could not answer that. Please try again." Type another message: the line clears as the new turn starts and the answer arrives.',
      },
    },
  },
  render: failedTurn,
}

export const CutShort: Story = {
  parameters: {
    runtime: scenarios.partialThenRunError,
    docs: {
      description: {
        story:
          'The answer ran past the Lambda deadline: the part that streamed stays in the bubble, and the line under the input says "The assistant took too long to respond." so the traveller knows it was cut short.',
      },
    },
  },
  render: failedTurn,
}

export const SessionExpired: Story = {
  parameters: {
    runtime: scenarios.http401,
    docs: {
      description: {
        story:
          'The session cookie is missing or expired (HTTP 401): "Your session has expired — sign in again to continue."',
      },
    },
  },
  render: failedTurn,
}

export const TooLong: Story = {
  parameters: {
    runtime: scenarios.http413,
    docs: {
      description: {
        story:
          'The conversation outgrew the 512 KB request limit (HTTP 413): "This conversation got too long — start a new one."',
      },
    },
  },
  render: failedTurn,
}

export const Throttled: Story = {
  parameters: {
    runtime: scenarios.http429,
    docs: {
      description: {
        story:
          'The traveller hit the per-person rate limit (HTTP 429): "Too many requests — give it a minute and try again."',
      },
    },
  },
  render: failedTurn,
}

export const Unavailable: Story = {
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story:
          'The runtime failed (HTTP 500): "The assistant is unavailable right now. Please try again." A 404 and a request that never reached the server (offline, DNS) read the same.',
      },
    },
  },
  render: failedTurn,
}

export const Offline: Story = {
  parameters: {
    runtime: scenarios.infoUnauthorized,
    docs: {
      description: {
        story:
          'The chat could not reach the runtime when it loaded, so it says so before anything is typed: "The assistant is unavailable right now. Reload the page to try again." Sending does nothing until the page is reloaded.',
      },
    },
  },
}

interface ReceivedFailure extends ChatFailure {
  id: string
  code: ChatFailureEvent['code']
}

interface HostHandlerProps {
  args: AiChatProps
}

// A host keeping its own record of failures — the list above the chat is what `onError` received.
const HostHandler = (props: HostHandlerProps) => {
  const { args } = props

  const [received, setReceived] = useState<ReceivedFailure[]>([])

  const onError = (failure: ChatFailure, event: ChatFailureEvent) => {
    setReceived((current) => {
      return [...current, { id: crypto.randomUUID(), code: event.code, ...failure }]
    })
  }

  return (
    <AIChat {...args} onError={onError}>
      <div className="border-b p-3 text-sm">
        <p className="font-medium">Your onError received</p>
        {received.length === 0 ? (
          <p className="opacity-60">nothing yet</p>
        ) : (
          received.map((failure) => {
            return (
              <p key={failure.id}>
                <code>{failure.code}</code> → <code>{failure.kind}</code> — {failure.text}
              </p>
            )
          })
        )}
      </div>
      <StartRun message={QUESTION} />
    </AIChat>
  )
}

export const OnErrorCallback: Story = {
  parameters: {
    runtime: scenarios.http429,
    docs: {
      description: {
        story: [
          'Pass `onError` to hear about every failure yourself — for analytics, a toast, or a sign-in redirect on `session-expired`. It gets the same `{ kind, text }` the line shows, plus the raw event. The panel above lists what it received for this throttled turn — one call per event, and a failed request reports two (`agent_run_failed_event`, then `agent_run_failed`).',
          "```tsx\n<AIChat\n  {...props}\n  onError={(failure, event) => {\n    if (failure.kind === 'session-expired') redirectToSignIn()\n  }}\n/>\n```",
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return <HostHandler args={args} />
  },
}
