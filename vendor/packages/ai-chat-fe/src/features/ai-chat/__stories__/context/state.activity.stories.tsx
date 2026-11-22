import type { Meta, StoryObj } from '@storybook/react'

import { scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { agentProgressRenderers } from '../../services/main.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { StartRun } from '../kit/start-run.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'ai-chat/Context and state/Activity messages',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('state.activity')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const QUESTION = 'Which Bangkok hotels earn Marriott Bonvoy points on a 21-night stay?'

export const ProgressWhileTheAgentWorks: Story = {
  args: {
    provider: { renderActivityMessages: agentProgressRenderers() },
  },
  parameters: {
    runtime: scenarios.agentProgress,
    docs: {
      description: {
        story: [
          'A line under the question that says what the agent is doing while it works: "Thinking…", "Looking up: hotels search, hotel detail…", "Writing the answer…", with "Step N of up to M" under it. It goes away when the run ends.',
          'The Lambda publishes this as one `agent-progress` activity per run; `agentProgressRenderers()` registers the line for it.',
          '```tsx\n<AIChat {...props} provider={{ renderActivityMessages: agentProgressRenderers() }} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message={QUESTION} />
      </AIChat>
    )
  },
}

export const CustomProgressCopy: Story = {
  args: {
    provider: {
      renderActivityMessages: agentProgressRenderers({
        labels: {
          thinking: () => {
            return 'Reading your question…'
          },
          researching: (tools) => {
            return `Checking ${tools.length} source${tools.length === 1 ? '' : 's'}…`
          },
          answering: () => {
            return 'Putting it together…'
          },
          step: (step, maxSteps) => {
            return `${step}/${maxSteps}`
          },
        },
      }),
    },
  },
  parameters: {
    runtime: scenarios.agentProgress,
    docs: {
      description: {
        story: [
          'The same progress line in your own words: every template is a function of what the agent reports (the humanised tool names, the step and the step budget).',
          `\`\`\`tsx
agentProgressRenderers({
  labels: {
    thinking: () => 'Reading your question…',
    researching: (tools) => \`Checking \${tools.length} sources…\`,
    answering: () => 'Putting it together…',
    step: (step, maxSteps) => \`\${step}/\${maxSteps}\`,
  },
})
\`\`\``,
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <StartRun message={QUESTION} />
      </AIChat>
    )
  },
}
