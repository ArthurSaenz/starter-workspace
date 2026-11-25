import { useSuggestions } from '@copilotkit/react-core/v2'
import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useRef } from 'react'

import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import { defineFeatureMeta, featureById } from '../kit/define-feature-meta.js'

const meta: Meta<typeof AIChat> = {
  // Literals, not `storyTitle(feature)` / `status:${feature.status}`: the CSF indexer reads title and
  // tags statically; features.test.ts pins both to the registry.
  title: 'features/ai-chat/Suggestions/Programmatic suggestions',
  tags: ['autodocs', 'status:on'],
  ...defineFeatureMeta(featureById('suggestions.programmatic')),
}

export default meta
type Story = StoryObj<typeof AIChat>

interface SuggestionControlsProps {
  /** Clears the pills as soon as they are registered, so the story opens on the cleared state. */
  clearOnOpen?: boolean
}

// Custom UI over the pills, as a consumer would mount it through `children`: `useSuggestions()`
// without an agent id resolves the configured agent from the configuration context.
const SuggestionControls = (props: SuggestionControlsProps) => {
  const { clearOnOpen } = props

  const { suggestions, reloadSuggestions, clearSuggestions } = useSuggestions()

  const clearedRef = useRef(false)

  useEffect(() => {
    if (!clearOnOpen || clearedRef.current || suggestions.length === 0) return

    clearedRef.current = true
    clearSuggestions()
  }, [clearOnOpen, clearSuggestions, suggestions.length])

  return (
    <div className="flex items-center gap-3 border-b p-3 text-sm">
      <span>{suggestions.length} pills</span>
      <button type="button" className="rounded border px-2 py-1" onClick={clearSuggestions}>
        Clear pills
      </button>
      <button type="button" className="rounded border px-2 py-1" onClick={reloadSuggestions}>
        Reload pills
      </button>
    </div>
  )
}

export const Controls: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'Your own UI over the pills: a component in `children` calls `useSuggestions()` and gets the same pills the chat shows, plus `clearSuggestions()` and `reloadSuggestions()`. The panel above the chat counts them; its buttons clear and bring them back.',
          '```tsx\nconst { suggestions, clearSuggestions, reloadSuggestions } = useSuggestions()\n```',
        ].join('\n\n'),
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SuggestionControls />
      </AIChat>
    )
  },
}

export const Cleared: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The same panel right after `clearSuggestions()`: no pills in the chat and the count reads 0. Clearing is local — nothing is sent. “Reload pills” brings the three back at once.',
      },
    },
  },
  render: (args) => {
    return (
      <AIChat {...args}>
        <SuggestionControls clearOnOpen />
      </AIChat>
    )
  },
}
