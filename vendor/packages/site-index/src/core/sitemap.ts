import type { SiteIndexConfig, SiteIndexEntry } from './types.js'

/** sitemaps.org protocol cap per file; past it a sitemap index is required. */
export const SITEMAP_MAX_URLS = 50_000

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const escapeXml = (value: string): string => {
  return value.replaceAll(/[&<>"']/g, (char) => {
    return XML_ESCAPES[char] ?? char
  })
}

/** Absolute URL with non-ASCII (Hebrew slugs) percent-encoded, as the protocol requires. */
export const toAbsoluteUrl = (origin: string, path: string): string => {
  return new URL(path, origin).href
}

const renderUrl = (entry: SiteIndexEntry, config: SiteIndexConfig): string => {
  const changefreq = entry.changefreq ?? config.defaults?.changefreq
  const priority = entry.priority ?? config.defaults?.priority
  const parts = [`<loc>${escapeXml(toAbsoluteUrl(config.origin, entry.path))}</loc>`]

  if (entry.lastmod) parts.push(`<lastmod>${escapeXml(entry.lastmod)}</lastmod>`)
  if (changefreq) parts.push(`<changefreq>${changefreq}</changefreq>`)
  if (priority !== undefined) parts.push(`<priority>${priority.toFixed(1)}</priority>`)

  return `<url>${parts.join('')}</url>`
}

export const renderSitemap = (entries: SiteIndexEntry[], config: SiteIndexConfig): string => {
  // A sitemap index is not implemented: the largest brand sitemap is ~1.1k URLs. Fail loudly
  // instead of publishing a file Google rejects.
  if (entries.length > SITEMAP_MAX_URLS) {
    throw new Error(`${entries.length} URLs exceed the ${SITEMAP_MAX_URLS} per-sitemap limit; add a sitemap index`)
  }

  const urls = entries.map((entry) => {
    return renderUrl(entry, config)
  })

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`
}
