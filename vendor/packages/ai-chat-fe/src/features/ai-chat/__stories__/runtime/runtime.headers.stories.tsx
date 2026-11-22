import type { Meta, StoryObj } from '@storybook/react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { WireLog } from '../kit/runtime.js'
import { StartRun } from '../kit/start-run.js'
import { runtimeOf } from '../kit/story-kit.js'

// Lower-case: `new Headers()` normalises names, and that is what the runtime reads.
const TRACE_HEADER = 'x-story-trace'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Runtime and auth/Headers',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('runtime.headers'), {
    render: (args, { loaded }) => {
      return (
        <AIChat {...args}>
          <WireLog runtime={runtimeOf(loaded)} runtimeUrl={args.runtimeUrl} header={TRACE_HEADER} />
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
          'Off by default: the preset sends no custom header — the session cookie, not a header, authenticates the traveller. The panel above the chat shows `x-story-trace: —` on every request.',
      },
    },
  },
}

export const HeaderReachesRuntime: Story = {
  args: { provider: { headers: { [TRACE_HEADER]: 'ada-42' } } },
  parameters: {
    docs: {
      description: {
        story: [
          '`provider.headers` adds headers to every request — the handshake and each turn. The panel above the chat shows `x-story-trace: ada-42` on both. A bearer token would travel the same way; the NomaDream runtime ignores headers it does not know.',
          "```tsx\n<AIChat {...props} provider={{ headers: { 'x-story-trace': 'ada-42' } }} />\n```",
        ].join('\n\n'),
      },
    },
  },
}
