import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { ConsoleLines } from '../kit/errors-console-lines.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Console re-emit',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('obs.consoleError'), {
    render: (args) => {
      return (
        <AIChat {...args}>
          <ConsoleLines method="error" prefix="[ai-chat]" title="console.error — [ai-chat] lines" />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const HandshakeFailed: Story = {
  parameters: {
    runtime: scenarios.infoUnauthorized,
    docs: {
      description: {
        story:
          'Every failure is also written to the browser console as `[ai-chat] <code>: <error>`, always on — something to grep in devtools and in browser tests. Here the chat could not reach the runtime on load: the panel above mirrors the line "[ai-chat] runtime_info_fetch_failed: Error: Runtime info request failed with status 404", next to the offline line under the input.',
      },
    },
  },
}

export const RunFailed: Story = {
  parameters: {
    runtime: scenarios.http500,
    docs: {
      description: {
        story:
          'A turn that failed with HTTP 500 logs `[ai-chat] agent_run_failed_event:` and `[ai-chat] agent_run_failed:`, each with the response body the runtime sent.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <ConsoleLines method="error" prefix="[ai-chat]" title="console.error — [ai-chat] lines" />
        <StartRun message="hello" />
      </AIChat>
    )
  },
}
