import type { CopilotChatInput } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'

import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Composer/Input slots',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('composer.slots')),
}

export default meta
type Story = StoryObj<typeof AIChat>

// Forwarding the slot's `onClick` (send, or stop while running) and `disabled` (empty input) keeps
// the composer's behaviour.
const SendItButton = (props: ComponentProps<typeof CopilotChatInput.SendButton>) => {
  const { onClick, disabled } = props

  return (
    <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClick} disabled={disabled}>
      Send it
    </button>
  )
}

export const CustomSendButton: Story = {
  args: {
    chat: { input: { sendButton: SendItButton } },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'A part of the composer swapped for your own — here a "Send it" button in place of the round arrow. It is disabled while the input is empty and sends like the original. The same `input` object takes `textArea`, `addMenuButton`, `disclaimer` and the other parts; the rest keep their defaults.',
          '```tsx\n<AIChat chat={{ input: { sendButton: SendItButton } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
