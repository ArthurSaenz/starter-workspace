import type { Args, Decorator, Meta } from '@storybook/react'
import { createElement } from 'react'

import { FEATURES, FeatureCardComponent, featureDocs } from '../../../catalogue/index.js'
import type { Feature } from '../../../catalogue/index.js'
import { NOMADREAM_PRESET, installRuntimeScenario, scenarios } from '../../__tests__/helpers/index.js'
import type { RuntimeScenario } from '../../__tests__/helpers/index.js'
import { AIChatRootContainer as AIChat } from '../../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../../types.js'

export type FeatureMeta<TArgs extends Args = AiChatProps> = Omit<Meta<TArgs>, 'title' | 'tags'>

// The preset plus the traveller context `AIChatContainer` derives from `userName: 'Ada'` — the
// moved plays assert that context entry on the wire, so the re-targeted stories carry it too.
const PRESET_ARGS: Partial<AiChatProps> = {
  ...NOMADREAM_PRESET,
  context: [{ description: 'Name of the signed-in traveller', value: 'Ada' }],
}

// Loaders, never an effect or decorator install: CopilotKitProvider fires `GET /info` from its own
// effect, which runs before any child or decorator effect, so an effect-installed fake lands too
// late and the chat boots to a runtime-info failure. Storybook awaits loaders before rendering.
// The preview decorator restores the real fetch on unmount.
const loaders: NonNullable<Meta<AiChatProps>['loaders']> = [
  async ({ parameters }) => {
    return {
      runtime: installRuntimeScenario((parameters.runtime as RuntimeScenario | undefined) ?? scenarios.default),
    }
  },
]

// What the fake supplies must be visible ON THE CANVAS, not only in the sidebar name and the Docs
// text: a FakeOnly_ interrupt otherwise looks like a working LangGraph interrupt (plan P4). The card
// also names the route a denial story exercises. Rendered above the chat, inside the bounded box.
interface CatalogueParameters {
  fakeSupplies?: readonly string[]
  deniedRoute?: string
}

const bannerDecorator = (feature: Feature): Decorator<AiChatProps> => {
  return (Story, context) => {
    const { fakeSupplies, deniedRoute } = (context.parameters.catalogue ?? {}) as CatalogueParameters

    if (!fakeSupplies?.length && !deniedRoute) return createElement(Story)

    return createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
      createElement(FeatureCardComponent, { feature, fakeSupplies, deniedRoute, className: 'm-2 shrink-0' }),
      createElement('div', { style: { flex: 1, minHeight: 0 } }, createElement(Story)),
    )
  }
}

/**
 * Everything a feature's stories file puts on `meta` except `title` and `tags`: Storybook's CSF
 * indexer reads both statically — a computed title crashes the build and tags inside a spread are
 * simply not seen (no `autodocs` page, no `status:` badge) — so each file writes `storyTitle(feature)`
 * and `['autodocs', 'status:<feature.status>']` as literals and `features.test.ts` pins them to the
 * registry. `extra` is spread last (`parameters` one level
 * deep, so a `layout` override keeps the Docs text and the catalogue id); a file that keeps a story
 * on `AIChatContainer` passes `component` and `args` together, which is why the base is cast to the
 * caller's args type.
 */
export const defineFeatureMeta = <TArgs extends Args = AiChatProps>(
  feature: Feature,
  extra?: FeatureMeta<TArgs>,
): FeatureMeta<TArgs> => {
  const base: FeatureMeta = {
    component: AIChat,
    parameters: {
      layout: 'fullscreen',
      docs: {
        // Every story fakes the runtime by replacing the ONE `window.fetch`, and a re-install
        // replaces the previous one. Inline Docs would render all stories in the same window, so
        // each story's loader would re-install over its siblings and every chat would boot against
        // the last scenario. `inline: false` gives each Docs story its own iframe and therefore its
        // own fetch.
        story: { inline: false },
        description: { component: featureDocs(feature) },
      },
      catalogue: { featureId: feature.id },
    },
    loaders,
    decorators: [bannerDecorator(feature)],
    args: PRESET_ARGS,
  }

  return {
    ...(base as FeatureMeta<TArgs>),
    ...extra,
    parameters: { ...base.parameters, ...extra?.parameters },
  }
}

export const featureById = (id: Feature['id']): Feature => {
  const feature = FEATURES.find((candidate) => {
    return candidate.id === id
  })

  if (!feature) throw new Error(`No catalogue feature ${id}`)

  return feature
}
