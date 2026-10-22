export type { BuildSiteIndexOptions, SiteIndexBuild, SiteIndexStats } from './core/build.js'
export { buildSiteIndex, DEFAULT_MAX_DROP_RATIO, getShrinkRefusal } from './core/build.js'
export { defineSiteIndexConfig } from './core/config.js'
export { renderLlmsTxt } from './core/llms.js'
export type { DuplicateEntry, MergedEntries } from './core/manifest.js'
export {
  createManifest,
  findDisallowedEntries,
  mergeManifests,
  parseManifest,
  SiteIndexError,
} from './core/manifest.js'
export type { RenderRobotsOptions } from './core/robots.js'
export { renderRobots } from './core/robots.js'
export { renderSitemap, SITEMAP_MAX_URLS, toAbsoluteUrl } from './core/sitemap.js'
export type {
  Changefreq,
  LlmsSection,
  SiteIndexConfig,
  SiteIndexEntry,
  SiteIndexFileName,
  SiteIndexFiles,
  SiteIndexManifest,
} from './core/types.js'
export { CHANGEFREQS, MANIFEST_VERSION } from './core/types.js'
