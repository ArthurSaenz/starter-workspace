import '@copilotkit/react-core/v2/styles.css'
import type { Preview } from '@storybook/react'
import * as React from 'react'

import '../src/styles.css'
import './tailwind.css'

// The runtime fake is installed by each story's `loaders` and exposes `restore()`; the shape is
// declared loosely here because the real module lands in `src/features/ai-chat/__tests__/helpers/` alongside the stories.
interface LoadedRuntime {
  restore?: () => void
}

const decorators: Preview['decorators'] = [
  (Story, context) => {
    // Restore-only on purpose: installing the fake here would be too late — `CopilotKitProvider`
    // fires `/info` from its own effect, which runs before a decorator effect. Installation happens
    // in story `loaders`, which Storybook awaits before rendering.
    // A ref keeps the cleanup unmount-only: an args change re-runs the loaders before re-rendering,
    // and a `[context.loaded]` dependency would restore right after that fresh install.
    const loadedRef = React.useRef(context.loaded)

    loadedRef.current = context.loaded
    React.useEffect(() => {
      return () => {
        const runtime = loadedRef.current?.runtime as LoadedRuntime | undefined

        runtime?.restore?.()
      }
    }, [])

    // CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
    return (
      <div style={{ height: 600 }}>
        <Story />
      </div>
    )
  },
]

const preview: Preview = {
  decorators,
  parameters: {
    options: {
      // The Catalogue page first, then the areas in registry order rather than alphabetically.
      // Literals, not `AREAS.map(…)`: Storybook evaluates `storySort` statically when it builds the
      // index and rejects a spread ("Unknown node type SpreadElement"); features.test.ts pins this
      // list to the registry.
      storySort: {
        order: [
          'ai-chat',
          [
            'Catalogue',
            'Surfaces and copy',
            'Suggestions',
            'Tools and generative UI',
            'Human in the loop',
            'Context and state',
            'Threads',
            'Composer',
            'Messages',
            'Theming and styling',
            'Runtime and auth',
            'Errors and observability',
            'Not exposed',
          ],
        ],
      },
    },
  },
}

export default preview
