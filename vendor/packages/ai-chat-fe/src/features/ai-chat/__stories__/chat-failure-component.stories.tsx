import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../__tests__/helpers/index.js'
import { ChatFailureComponent } from '../components/chat-failure-component.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import type { ChatFailureLineProps } from '../types.js'
import { defineFeatureMeta, featureById } from './kit/define-feature-meta.js'
import { StartRun } from './kit/start-run.js'
import { SESSION_EXPIRED_TEXT, UNAVAILABLE_TEXT } from './kit/story-kit.js'

// Stays at this path (`@wl/require-component-stories` derives `__stories__/<component>.stories.tsx`
// from the component file and only checks it exists) but is the `errors.line` feature file: the
// line on its own sits next to the chat-level stories that show the `features.errorLine` seam.
const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Traveller error line',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('errors.line')),
}

export default meta

type Story = StoryObj<typeof AIChat>

const failedTurn: Story['render'] = (args) => {
  return (
    <AIChat {...args}>
      <StartRun message="hello" />
    </AIChat>
  )
}

export const InChat: Story = {
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story:
          'The line as travellers see it, on by default: a turn failed, so "The assistant is unavailable right now. Please try again." sits in red under the input. The input stays usable, and the next turn clears the line.',
      },
    },
  },
  render: failedTurn,
}

export const Unavailable: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'The line on its own — `ChatFailureComponent` — for a host that lays out its own chat. It is an alert, so screen readers announce it.\n\n```tsx\n<ChatFailureComponent failure={{ kind: "unavailable", text: "The assistant is unavailable right now. Please try again." }} />\n```',
      },
    },
  },
  render: () => {
    return <ChatFailureComponent failure={{ kind: 'unavailable', text: UNAVAILABLE_TEXT }} />
  },
}

export const SessionExpired: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'The line on its own for an expired session: "Your session has expired — sign in again to continue."',
      },
    },
  },
  render: () => {
    return <ChatFailureComponent failure={{ kind: 'session-expired', text: SESSION_EXPIRED_TEXT }} />
  },
}

// A consumer's replacement: it receives the same `failure` the package line would, so the kind and
// text are its to render.
const HostErrorBox = (props: ChatFailureLineProps) => {
  const { failure } = props

  return (
    <div role="alert" style={{ border: '2px solid currentColor', borderRadius: 8, margin: '0 16px 8px', padding: 8 }}>
      Something went wrong ({failure.kind}): {failure.text}
    </div>
  )
}

export const CustomErrorLine: Story = {
  args: { features: { errorLine: HostErrorBox } },
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story: [
          'Your own component in place of the line: it gets the same `{ failure: { kind, text } }`. Here a bordered box reads "Something went wrong (unavailable): …" under the input, and the package line is gone.',
          '```tsx\n<AIChat {...props} features={{ errorLine: HostErrorBox }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: failedTurn,
}

export const ReWorded: Story = {
  args: {
    features: {
      errorLine: { text: { unavailable: 'Our concierge is taking a short break — try again in a moment.' } },
    },
  },
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story: [
          'The package line with your own words: the same failure reads "Our concierge is taking a short break — try again in a moment." Kinds you do not list keep their default text.',
          "```tsx\n<AIChat {...props} features={{ errorLine: { text: { unavailable: 'Our concierge is taking a short break — try again in a moment.' } } }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: failedTurn,
}

export const Off: Story = {
  args: { features: { errorLine: false } },
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story:
          '`features.errorLine: false` — the same failed turn shows nothing: the question stays, no answer, no red line. The failure still reaches `onError` and the console, for a host that shows it somewhere else.',
      },
    },
  },
  render: failedTurn,
}
