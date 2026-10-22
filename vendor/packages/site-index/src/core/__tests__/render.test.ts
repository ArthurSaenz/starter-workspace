import { describe, expect, it } from 'vitest'

import { renderLlmsTxt } from '../llms.js'
import { renderRobots } from '../robots.js'
import { SITEMAP_MAX_URLS, renderSitemap } from '../sitemap.js'
import { config } from './fixtures.js'

describe('renderSitemap', () => {
  it('writes absolute, escaped, percent-encoded locs with config defaults', () => {
    const xml = renderSitemap(
      [
        { path: '/' },
        { path: '/airlines/?airline=1&lang=he', changefreq: 'weekly', priority: 0.5, lastmod: '2026-10-01' },
        { path: '/shows/תל-אביב' },
      ],
      config,
    )

    expect(xml).toMatch(/^<\?xml[^>]*\?><urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
    expect(xml).toContain(
      '<url><loc>https://www.hulyo.co.il/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>',
    )
    expect(xml).toContain(
      '<loc>https://www.hulyo.co.il/airlines/?airline=1&amp;lang=he</loc><lastmod>2026-10-01</lastmod><changefreq>weekly</changefreq><priority>0.5</priority>',
    )
    expect(xml).toContain('<loc>https://www.hulyo.co.il/shows/%D7%AA%D7%9C-%D7%90%D7%91%D7%99%D7%91</loc>')
  })

  it('refuses more URLs than one sitemap may hold', () => {
    const entries = Array.from({ length: SITEMAP_MAX_URLS + 1 }, (_, index) => {
      return { path: `/p/${index}` }
    })

    expect(() => {
      return renderSitemap(entries, config)
    }).toThrow(/sitemap index/)
  })
})

describe('renderRobots', () => {
  it('allows every agent and advertises the sitemap when crawlable', () => {
    expect(renderRobots(config, { crawlable: true })).toBe(
      [
        'User-agent: *',
        'Allow: /',
        '',
        '# AI crawlers',
        'User-agent: GPTBot',
        'Allow: /',
        '',
        'User-agent: OAI-SearchBot',
        'Allow: /',
        '',
        'Sitemap: https://www.hulyo.co.il/sitemap.xml',
        '',
      ].join('\n'),
    )
  })

  it('disallows every agent and drops the sitemap line otherwise', () => {
    const robots = renderRobots(config, { crawlable: false })

    expect(robots).not.toContain('Allow:')
    expect(robots).not.toContain('Sitemap:')
    expect(robots.match(/Disallow: \//g)).toHaveLength(3)
  })
})

describe('renderLlmsTxt', () => {
  it('renders the llmstxt.org layout: H1, summary, details, sections in config order, Optional last', () => {
    const text = renderLlmsTxt(
      [
        { path: '/', title: 'Home' },
        { path: '/shows/eilat', group: 'shows', title: 'Shows in [Eilat]', description: 'Stand-up\nand concerts' },
        { path: '/flights/round-trip', group: 'flights' },
        { path: '/terms', group: 'legal', title: 'Terms' },
        { path: '/hidden', llms: false },
        { path: '/misc', group: 'unknown-group' },
      ],
      config,
    )

    expect(text).toBe(
      [
        '# Hulyo',
        '',
        '> Israeli travel deals.',
        '',
        'Prices change often; do not present them as guaranteed.',
        '',
        '## Pages',
        '',
        '- [Home](https://www.hulyo.co.il/)',
        '- [/misc](https://www.hulyo.co.il/misc)',
        '',
        '## Flights',
        '',
        '- [/flights/round-trip](https://www.hulyo.co.il/flights/round-trip)',
        '',
        '## Shows',
        '',
        '- [Shows in \\[Eilat\\]](https://www.hulyo.co.il/shows/eilat): Stand-up and concerts',
        '',
        '## Optional',
        '',
        '- [Terms](https://www.hulyo.co.il/terms)',
        '',
      ].join('\n'),
    )
  })

  it('omits empty sections', () => {
    const text = renderLlmsTxt([{ path: '/flights/one-way', group: 'flights' }], config)

    expect(text).not.toContain('## Shows')
    expect(text).not.toContain('## Pages')
    expect(text).not.toContain('## Optional')
  })
})
