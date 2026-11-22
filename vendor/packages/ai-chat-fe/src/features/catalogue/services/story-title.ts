import type { Feature } from '../types.js'
import { areaById } from './areas.js'

export const CATALOGUE_STORY_TITLE = 'ai-chat/Catalogue'

// Empty since the pre-catalogue `ai-chat/AIChatContainer` and `ai-chat/ChatFailureComponent` files
// were folded into the per-feature files; kept so a future one-off title has a declared home.
export const LEGACY_STORY_TITLES: readonly string[] = []

// Every feature now has its stories file (Phase 4.12 flipped this); `features.test.ts` asserts the
// "every hasStoriesFile feature has a module" rule and `scripts/check-storybook-index.mjs` gates the
// built index the same way. Set it back to false only while a new area's files are being added.
export const EXPECT_COMPLETE = true

export const hasStoriesFile = (feature: Feature): boolean => {
  return feature.status !== 'not-applicable'
}

export const storyTitle = (feature: Feature): string => {
  return `ai-chat/${areaById(feature.area).title}/${feature.title}`
}

export const expectedStoryTitles = (features: readonly Feature[]): ReadonlySet<string> => {
  return new Set([CATALOGUE_STORY_TITLE, ...features.filter(hasStoriesFile).map(storyTitle), ...LEGACY_STORY_TITLES])
}
