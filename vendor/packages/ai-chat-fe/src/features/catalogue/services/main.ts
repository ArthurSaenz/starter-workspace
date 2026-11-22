// CopilotKit-free and React-free on purpose: `scripts/*.mjs` import the built
// `dist/features/catalogue/services/main.js` under plain node, which cannot load react-core's `.css`
// import. `feature-docs.ts` (react-core) is reachable only through the feature barrel.
export { areaById, AREAS } from './areas.js'
export { FEATURES } from './registry.js'
export { countByStatus, renderCatalogueMarkdown, seamLabel, statusLabel } from './render-markdown.js'
export {
  CATALOGUE_STORY_TITLE,
  EXPECT_COMPLETE,
  expectedStoryTitles,
  hasStoriesFile,
  LEGACY_STORY_TITLES,
  storyTitle,
} from './story-title.js'
