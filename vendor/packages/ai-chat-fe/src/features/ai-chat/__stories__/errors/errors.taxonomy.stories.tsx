import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../../../catalogue/index.js'
import {
  GENERIC_ERROR_BODY,
  PAYLOAD_TOO_LARGE_BODY,
  RUN_ERROR_MESSAGE,
  TOO_MANY_REQUESTS_BODY,
  UNAUTHORIZED_BODY,
} from '../../__tests__/helpers/index.js'
import { ChatFailureComponent } from '../../components/chat-failure-component.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { describeChatFailure } from '../../services/main.js'
import type { ChatFailureEvent } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const feature = featureById('errors.taxonomy')

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Failure taxonomy',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(feature, { parameters: { layout: 'padded' } }),
}

export default meta
type Story = StoryObj<typeof AIChat>

// The same shape @ag-ui/client's fetch wrapper throws: `Error("HTTP <status>: <body>")` with
// `.status` attached — what the `Error events` stories get from the fake.
const httpError = (status: number, body: string): Error => {
  return Object.assign(new Error(`HTTP ${status}: ${body}`), { status })
}

interface TaxonomyRow {
  label: string
  event: ChatFailureEvent
  drivenBy: string
}

const ROWS: readonly TaxonomyRow[] = [
  {
    label: 'GET /info fails (runtime_info_fetch_failed)',
    event: { code: 'runtime_info_fetch_failed', error: new Error('Runtime info request failed with status 404') },
    drivenBy: 'Error events / Offline',
  },
  {
    label: 'RUN_ERROR frame (agent_run_error_event)',
    event: { code: 'agent_run_error_event', error: new Error(RUN_ERROR_MESSAGE) },
    drivenBy: 'Error events / RunError, CutShort',
  },
  {
    label: 'HTTP 401 (agent_run_failed_event)',
    event: { code: 'agent_run_failed_event', error: httpError(401, UNAUTHORIZED_BODY) },
    drivenBy: 'Error events / SessionExpired',
  },
  {
    label: 'HTTP 413 (agent_run_failed_event)',
    event: { code: 'agent_run_failed_event', error: httpError(413, PAYLOAD_TOO_LARGE_BODY) },
    drivenBy: 'Error events / TooLong',
  },
  {
    label: 'HTTP 429 (agent_run_failed_event)',
    event: { code: 'agent_run_failed_event', error: httpError(429, TOO_MANY_REQUESTS_BODY) },
    drivenBy: 'Error events / Throttled',
  },
  {
    label: 'HTTP 500 (agent_run_failed_event)',
    event: { code: 'agent_run_failed_event', error: httpError(500, GENERIC_ERROR_BODY) },
    drivenBy: 'Error events / Unavailable (a 404 and a failed fetch read the same)',
  },
]

// The mapping rendered through the real line component, one row per event the Lambda can produce.
const TaxonomyTable = () => {
  return (
    <div className="grid gap-3">
      <FeatureCardComponent feature={feature} />
      <table className="text-sm">
        <thead>
          <tr className="text-left">
            <th className="pr-4">Event</th>
            <th className="pr-4">Line</th>
            <th>See it live in</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            return (
              <tr key={row.label}>
                <td className="pr-4 align-top">
                  <code>{row.label}</code>
                </td>
                <td className="pr-4 align-top">
                  <ChatFailureComponent failure={describeChatFailure(row.event)} className="text-left" />
                </td>
                <td className="align-top">{row.drivenBy}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export const Overview: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Every failure the traveller can be shown, one row per event the Lambda can produce, rendered through the real error line: a failed handshake reads as offline, a RUN_ERROR frame shows the Lambda’s own sentence, HTTP 401 / 413 / 429 get their own copy, and anything else is "unavailable". The last column names the story that shows it inside the chat.',
          '`describeChatFailure(event)` does the mapping; reword any kind through `features.errorLine`:',
          "```tsx\n<AIChat {...props} features={{ errorLine: { text: { throttled: 'Easy there — try again in a minute.' } } }} />\n```",
        ].join('\n\n'),
      },
    },
  },
  render: () => {
    return <TaxonomyTable />
  },
}
