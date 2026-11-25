import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { ConsoleLines } from '../kit/errors-console-lines.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Debug logging',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('obs.debug'), {
    render: (args) => {
      return (
        <AIChat {...args}>
          <ConsoleLines method="debug" prefix="[LIFECYCLE]" title="console.debug — [LIFECYCLE] lines" />
          <StartRun message="hello" />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Off by default: a whole turn has run and nothing was written to `console.debug` — the panel above stays empty.',
      },
    },
  },
}

export const LifecycleLogged: Story = {
  args: { provider: { debug: true } },
  parameters: {
    docs: {
      description: {
        story: [
          'Turned on, each turn logs its lifecycle to `console.debug` — "[LIFECYCLE] Run started:" with the agent and thread ids, then a finished line. The panel above mirrors them. For local debugging only.',
          '```tsx\n<AIChat {...props} provider={{ debug: true }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
