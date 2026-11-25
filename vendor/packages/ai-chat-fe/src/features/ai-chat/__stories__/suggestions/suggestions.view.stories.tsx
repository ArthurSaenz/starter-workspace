import type { CopilotChatSuggestionPill } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'

import { NOMADREAM_PRESET, scenarios } from '../../__tests__/helpers/index.js'
import type { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatSuggestion } from '../../types.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Suggestions/Pill rendering',
  tags: ['autodocs', 'status:off-by-default'],
  ...defineFeatureMeta(featureById('suggestions.view')),
}

export default meta
type Story = StoryObj<typeof AIChat>

const HIGHLIGHT_CLASS = 'font-bold'
const [LONG_STAY, ...OTHER_PILLS] = NOMADREAM_PRESET.features.suggestions

if (!LONG_STAY) throw new Error('The preset has no suggestion pills')

// `Suggestion.className` reaches the pill slot as `className`, so the story's pill forwards it —
// the first pill is bold through that per-item route.
const PILLS: AiChatSuggestion[] = [{ ...LONG_STAY, className: HIGHLIGHT_CLASS }, ...OTHER_PILLS]

type PillProps = ComponentProps<typeof CopilotChatSuggestionPill>

// CopilotKit's pills container is `pointer-events: none` and its own pill opts back in; a
// replacement pill that forgets to renders fine and cannot be clicked.
const StoryPill = (props: PillProps) => {
  const { children, className, onClick, isLoading } = props

  return (
    <button
      type="button"
      data-testid="story-pill"
      className={`rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-sm ${className ?? ''}`}
      style={{ pointerEvents: 'auto' }}
      onClick={onClick}
      disabled={isLoading}
    >
      ★ {children}
    </button>
  )
}

export const CustomPill: Story = {
  args: {
    chat: { ...NOMADREAM_PRESET.chat, suggestionView: { suggestion: StoryPill } },
    features: { ...NOMADREAM_PRESET.features, suggestions: PILLS },
  },
  parameters: {
    runtime: scenarios.suggestionClick,
    docs: {
      description: {
        story: [
          "`chat.suggestionView: { suggestion: StoryPill }` swaps the pill component: the pills render as the story's own `★` buttons, and a suggestion's own `className` reaches its pill — the first one is bold through `className: 'font-bold'`. Clicking one still sends its full question.",
          'CopilotKit’s pill row ignores the pointer, so a custom pill sets `pointer-events: auto` itself — without it the pill shows but cannot be clicked.',
          '```tsx\n<AIChat {...props} chat={{ suggestionView: { suggestion: StoryPill } }} />\n```',
        ].join('\n\n'),
      },
    },
  },
}
