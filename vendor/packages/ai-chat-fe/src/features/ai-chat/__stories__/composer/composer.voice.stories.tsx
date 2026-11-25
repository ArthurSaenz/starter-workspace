import type { Meta, StoryObj } from '@storybook/react'

import { VOICE_TRANSCRIPT, scenarios } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'
import { WireLog } from '../kit/runtime.js'
import { runtimeOf } from '../kit/story-kit.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Composer/Voice input',
  tags: ['autodocs', 'status:on-with-caveat'],
  ...defineFeatureMeta(featureById('composer.voice'), {
    // The log puts the `POST /transcribe` on screen next to the transcript it brings back.
    render: (args, { loaded }) => {
      return (
        <AIChat {...args}>
          <WireLog runtime={runtimeOf(loaded)} runtimeUrl={args.runtimeUrl} />
        </AIChat>
      )
    },
  }),
}

export default meta
type Story = StoryObj<typeof AIChat>

export const Dictated: Story = {
  parameters: {
    runtime: scenarios.voice,
    docs: {
      description: {
        story: [
          'The runtime says it can transcribe (`/info` → `audioFileTranscriptionEnabled: true`, which our Lambda answers only when it has a Gemini key), so a microphone sits next to the send button.',
          'Click it and allow the microphone, say something, then click the check mark: the recording goes to `POST …/transcribe` and the text that comes back lands in the input, ready to edit or send. Here the stand-in runtime always hears',
          `> ${VOICE_TRANSCRIPT}`,
          'Nothing in the app sets this up — the mic follows the runtime.',
        ].join('\n\n'),
      },
    },
  },
}

export const RateLimited: Story = {
  parameters: {
    runtime: scenarios.voiceRateLimited,
    docs: {
      description: {
        story:
          'The same microphone, but the speech-to-text provider is rate-limiting (`429 rate_limited`). After you finish a recording the chat shows "Too many requests. Please wait a moment." for five seconds; whatever was already in the input stays as it was, and typing still works.',
      },
    },
  },
}
