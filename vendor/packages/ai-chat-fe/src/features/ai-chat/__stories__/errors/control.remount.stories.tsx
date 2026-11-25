import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { SeedTranscript } from '../kit/seed-transcript.js'
import { SHORT_EXCHANGE } from '../kit/transcripts.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Errors and observability/Reset on user switch',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('control.remount')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface TravellerSwitchProps {
  args: AiChatProps
}

// What a host does when the signed-in traveller changes: a new `key` on `<AIChat>`. Only the first
// traveller gets the seeded conversation, so the switch visibly lands on an empty chat.
const TravellerSwitch = (props: TravellerSwitchProps) => {
  const { args } = props

  const [traveller, setTraveller] = useState(1)

  return (
    <AIChat key={traveller} {...args}>
      <div className="border-b p-3 text-sm">
        Signed in as traveller {traveller}{' '}
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => {
            setTraveller((current) => {
              return current + 1
            })
          }}
        >
          Switch traveller
        </button>
      </div>
      {traveller === 1 && <SeedTranscript messages={SHORT_EXCHANGE} />}
    </AIChat>
  )
}

export const KeyRemountClears: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Traveller 1 has a conversation on screen. Press "Switch traveller": `<AIChat>` gets a new React `key`, so the whole chat starts over — welcome screen, no messages, and a fresh conversation id for the next question. Nothing is saved, so the old conversation is gone for good.',
          '```tsx\n<AIChat key={travellerId} {...props} />\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return <TravellerSwitch args={args} />
  },
}
