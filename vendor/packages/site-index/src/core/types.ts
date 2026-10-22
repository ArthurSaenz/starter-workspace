export const MANIFEST_VERSION = 1

export const CHANGEFREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'] as const

export type Changefreq = (typeof CHANGEFREQS)[number]

export interface SiteIndexEntry {
  /** Site-relative path, `/flights/round-trip`. The host comes from the config, never from a producer. */
  path: string
  /** Section key in llms.txt; matches `llms.sections[].group`. */
  group?: string
  title?: string
  description?: string
  changefreq?: Changefreq
  priority?: number
  /** ISO date of the last content change. */
  lastmod?: string
  /** `false` keeps the URL in sitemap.xml but out of llms.txt. */
  llms?: boolean
}

export interface SiteIndexManifest {
  producer: string
  version: typeof MANIFEST_VERSION
  generatedAt: string
  urls: SiteIndexEntry[]
}

export interface LlmsSection {
  group: string
  title: string
}

export interface SiteIndexConfig {
  /** Brand name, the llms.txt H1. */
  name: string
  /** Canonical origin every sitemap `<loc>` and llms.txt link is written against: `https://www.hulyo.co.il`. */
  origin: string
  /** Path prefixes that must never be indexed; a manifest URL under one fails the build. */
  disallow: string[]
  robots: {
    /** User agents granted the same rule as `*`, listed separately so the grant is explicit to AI crawlers. */
    aiBots: string[]
  }
  llms: {
    summary: string
    /** Free-form paragraphs between the summary and the first section. */
    details?: string[]
    /** Section order. Entries whose group is not listed fall into `defaultSectionTitle`. */
    sections: LlmsSection[]
    defaultSectionTitle?: string
    /** Groups rendered under `## Optional` — the llmstxt.org section a client may skip for a short context. */
    optionalGroups?: string[]
  }
  defaults?: {
    changefreq?: Changefreq
    priority?: number
  }
}

export interface SiteIndexFiles {
  'sitemap.xml': string
  'robots.txt': string
  'llms.txt': string
}

export type SiteIndexFileName = keyof SiteIndexFiles
