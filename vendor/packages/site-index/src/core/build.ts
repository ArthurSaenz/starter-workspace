import { renderLlmsTxt } from './llms.js'
import type { DuplicateEntry } from './manifest.js'
import { SiteIndexError, findDisallowedEntries, mergeManifests } from './manifest.js'
import { renderRobots } from './robots.js'
import { renderSitemap } from './sitemap.js'
import type { SiteIndexConfig, SiteIndexEntry, SiteIndexFiles, SiteIndexManifest } from './types.js'

export interface BuildSiteIndexOptions {
  crawlable: boolean
}

export interface SiteIndexStats {
  urlCount: number
  llmsUrlCount: number
  producers: Record<string, number>
  duplicates: DuplicateEntry[]
}

export interface SiteIndexBuild {
  files: SiteIndexFiles
  stats: SiteIndexStats
}

const sortByProducer = (manifests: SiteIndexManifest[]): SiteIndexManifest[] => {
  return [...manifests].sort((left, right) => {
    return left.producer.localeCompare(right.producer)
  })
}

const assertUniqueProducers = (manifests: SiteIndexManifest[]) => {
  const seen = new Set<string>()

  const repeated = manifests.flatMap((manifest) => {
    if (!seen.has(manifest.producer)) {
      seen.add(manifest.producer)

      return []
    }

    return [manifest.producer]
  })

  if (repeated.length > 0) throw new SiteIndexError('Two manifests claim the same producer', repeated)
}

const assignGroups = (entries: SiteIndexEntry[], config: SiteIndexConfig): SiteIndexEntry[] => {
  const prefixes = Object.entries(config.llms.groupPrefixes ?? {})

  if (prefixes.length === 0) return entries

  return entries.map((entry) => {
    if (entry.group) return entry

    const match = prefixes.find(([, groupPrefixes]) => {
      return groupPrefixes.some((prefix) => {
        return entry.path.startsWith(prefix)
      })
    })

    return match ? { ...entry, group: match[0] } : entry
  })
}

export const buildSiteIndex = (
  config: SiteIndexConfig,
  manifests: SiteIndexManifest[],
  options: BuildSiteIndexOptions,
): SiteIndexBuild => {
  assertUniqueProducers(manifests)

  const sorted = sortByProducer(manifests)
  const merged = mergeManifests(sorted)
  const { duplicates } = merged
  const entries = assignGroups(merged.entries, config)
  const disallowed = findDisallowedEntries(entries, config)

  if (disallowed.length > 0) throw new SiteIndexError('Manifests list disallowed paths', disallowed)

  const producers = Object.fromEntries(
    sorted.map((manifest) => {
      return [manifest.producer, manifest.urls.length]
    }),
  )

  return {
    files: {
      'sitemap.xml': renderSitemap(entries, config),
      'robots.txt': renderRobots(config, options),
      'llms.txt': renderLlmsTxt(entries, config),
    },
    stats: {
      urlCount: entries.length,
      llmsUrlCount: entries.filter((entry) => {
        return entry.llms !== false
      }).length,
      producers,
      duplicates,
    },
  }
}

/** Fraction of URLs a run may lose against the previous one before it refuses to publish. */
export const DEFAULT_MAX_DROP_RATIO = 0.3

/**
 * A producer that ships a broken or truncated manifest would otherwise silently shrink the live
 * sitemap. Returns the reason to refuse, or `null` when the drop is within bounds.
 */
export const getShrinkRefusal = (
  previousCount: number | undefined,
  nextCount: number,
  maxDropRatio = DEFAULT_MAX_DROP_RATIO,
): string | null => {
  if (!previousCount) return null

  const dropRatio = (previousCount - nextCount) / previousCount

  if (dropRatio <= maxDropRatio) return null

  return `URL count fell from ${previousCount} to ${nextCount} (-${Math.round(dropRatio * 100)}%), above the ${Math.round(maxDropRatio * 100)}% limit; re-run with { force: true } if the drop is intended`
}
