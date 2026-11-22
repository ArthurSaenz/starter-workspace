import type { Meta } from '@storybook/react'
import { describe, expect, it } from 'vitest'

import preview from '../../../../.storybook/preview.js'
import {
  AREAS,
  CATALOGUE_STORY_TITLE,
  EXPECT_COMPLETE,
  FEATURES,
  LEGACY_STORY_TITLES,
  expectedStoryTitles,
  hasStoriesFile,
  storyTitle,
} from '../services/main.js'

interface StoryExport {
  parameters?: { catalogue?: { fakeSupplies?: readonly string[]; deniedRoute?: string } }
}

interface StoriesModule {
  default: Meta
  [storyName: string]: unknown
}

// Both features' stories files; the glob is the same one the composeStories runner uses, so a file
// this test sees is a file Storybook indexes.
const modules = import.meta.glob<StoriesModule>('../../*/__stories__/**/*.stories.tsx', { eager: true })

const storiesOf = (module: StoriesModule): Record<string, StoryExport> => {
  return Object.fromEntries(
    Object.entries(module)
      .filter(([name]) => {
        return name !== 'default'
      })
      .map(([name, story]) => {
        return [name, story as StoryExport]
      }),
  )
}

const modulesByTitle = new Map<string, Record<string, StoryExport>>()
const tagsByTitle = new Map<string, readonly string[]>()

for (const [path, module] of Object.entries(modules)) {
  const title = module.default.title

  if (typeof title !== 'string') throw new TypeError(`${path} has no default.title`)
  modulesByTitle.set(title, { ...modulesByTitle.get(title), ...storiesOf(module) })
  tagsByTitle.set(title, [...(tagsByTitle.get(title) ?? []), ...(module.default.tags ?? [])])
}

const areaIds = new Set(
  AREAS.map((area) => {
    return area.id
  }),
)

describe('catalogue registry', () => {
  it('has unique ids', () => {
    const ids = FEATURES.map((feature) => {
      return feature.id
    })

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('places every feature in a known area', () => {
    for (const feature of FEATURES) expect(areaIds.has(feature.area), feature.id).toBe(true)
  })

  it('names blockedBy exactly when backend-blocked (or license-gated out of scope)', () => {
    for (const feature of FEATURES) {
      if (feature.status === 'backend-blocked') {
        expect(feature.blockedBy?.length ?? 0, feature.id).toBeGreaterThan(0)
      } else if (feature.blockedBy) {
        expect(feature.status, feature.id).toBe('out-of-scope')
        expect(feature.blockedBy, feature.id).toEqual(['license'])
      }
    }
  })

  it('lists stories exactly for the features that have a stories file', () => {
    for (const feature of FEATURES) {
      expect(feature.stories.length > 0, feature.id).toBe(hasStoriesFile(feature))
    }
  })

  it('keeps titles free of the Storybook hierarchy separator', () => {
    for (const area of AREAS) expect(area.title).not.toMatch(/[/&]/)
    for (const feature of FEATURES) expect(feature.title, feature.id).not.toContain('/')
  })
})

describe('stories files against the registry', () => {
  const expected = expectedStoryTitles(FEATURES)

  it('titles every stories file from the registry, the catalogue or the legacy list', () => {
    const unexpected = [...modulesByTitle.keys()].filter((title) => {
      return !expected.has(title)
    })

    expect(unexpected).toEqual([])
  })

  // Completeness cannot pass before Phase 4.12 creates the per-feature files; until
  // `EXPECT_COMPLETE` flips, `scripts/check-storybook-index.mjs` reports the missing titles instead.
  it.runIf(EXPECT_COMPLETE)('has a stories file for every feature that needs one', () => {
    const missing = FEATURES.filter(hasStoriesFile)
      .map(storyTitle)
      .filter((title) => {
        return !modulesByTitle.has(title)
      })

    expect(missing).toEqual([])
    expect(LEGACY_STORY_TITLES).toEqual([])
  })

  it('renders the catalogue module itself', () => {
    expect(modulesByTitle.has(CATALOGUE_STORY_TITLE)).toBe(true)
  })

  // The preview's `storySort` is a literal list (Storybook parses it statically), so the registry
  // order is asserted here instead of derived there.
  it('sorts the sidebar as the registry orders the areas', () => {
    const storySort = preview.parameters?.options?.storySort as { order?: unknown[] } | undefined

    const areaTitles = AREAS.map((area) => {
      return area.title
    })

    expect(storySort?.order).toEqual(['ai-chat', ['Catalogue', ...areaTitles]])
  })

  for (const feature of FEATURES.filter(hasStoriesFile)) {
    const title = storyTitle(feature)
    const stories = modulesByTitle.get(title)

    if (!stories) continue

    describe(title, () => {
      // Literal in every file because the CSF indexer reads tags statically: a spread from the kit
      // would leave the feature without its autodocs page and its status badge.
      it('tags the file autodocs and with the registry status', () => {
        expect(tagsByTitle.get(title)).toContain('autodocs')
        expect(tagsByTitle.get(title)).toContain(`status:${feature.status}`)
      })

      it('exports only stories the registry lists', () => {
        for (const name of Object.keys(stories)) expect(feature.stories, name).toContain(name)
      })

      // The other direction waits for Phase 4: the moved stories landed in files whose rows also
      // list stories that do not exist yet, and the flip of `EXPECT_COMPLETE` is what turns a
      // still-missing name into a failure.
      it.runIf(EXPECT_COMPLETE)('exports every story the registry lists', () => {
        for (const name of feature.stories) expect(Object.keys(stories), name).toContain(name)
      })

      it('uses FakeOnly_ only for a lambda-backend block with named fake supplies', () => {
        for (const [name, story] of Object.entries(stories)) {
          if (!name.startsWith('FakeOnly_')) continue
          expect(feature.blockedBy ?? [], name).toContain('lambda-backend')
          expect(story.parameters?.catalogue?.fakeSupplies?.length ?? 0, name).toBeGreaterThan(0)
        }
      })

      it.runIf(feature.status === 'backend-blocked' && !feature.blockedBy?.includes('lambda-backend'))(
        'shows only the denial when blocked by a route, a license or the transport',
        () => {
          for (const [name, story] of Object.entries(stories)) {
            if (name === 'Overview') continue
            expect(story.parameters?.catalogue?.deniedRoute, name).toEqual(expect.any(String))
          }
        },
      )
    })
  }
})
