import { describe, expect, it } from 'vitest'

import { SiteIndexError, createManifest, findDisallowedEntries, mergeManifests, parseManifest } from '../manifest.js'
import { config, manifest } from './fixtures.js'

const getError = (raw: unknown, source = 's3://bucket/manifests/seo.json'): SiteIndexError => {
  try {
    parseManifest(raw, source)
  } catch (error) {
    if (error instanceof SiteIndexError) return error
    throw error
  }

  throw new Error('expected parseManifest to throw')
}

describe('parseManifest', () => {
  it('keeps every valid field', () => {
    const entry = {
      path: '/shows/tel-aviv',
      group: 'shows',
      title: 'Tel Aviv',
      description: 'Shows',
      changefreq: 'weekly' as const,
      priority: 0.5,
      lastmod: '2026-10-22',
      llms: false,
    }

    expect(parseManifest(manifest('seo', [entry]), 'seo.json').urls).toEqual([entry])
  })

  it('reports every invalid entry with its position, its path and the expected value', () => {
    const error = getError(
      manifest('seo', [
        { path: 'https://www.hulyo.co.il/x' },
        { path: '/ok', changefreq: 'sometimes' as never },
        { path: '/ok2', priority: 2, title: 5 as never, lastmod: 'yesterday' },
      ]),
    )

    expect(error.message).toContain('Manifest s3://bucket/manifests/seo.json is invalid')
    expect(error.issues).toEqual([
      'urls[0].path "https://www.hulyo.co.il/x": must start with a single "/" and carry no host',
      'urls[1] (/ok).changefreq: got "sometimes", expected one of always, hourly, daily, weekly, monthly, yearly, never',
      'urls[2] (/ok2).priority: got 2, expected a number in 0..1',
      'urls[2] (/ok2).title: got 5, expected a string',
      'urls[2] (/ok2).lastmod: got "yesterday", expected an ISO date such as "2026-10-22"',
    ])
  })

  it('rejects unknown fields so a typo cannot vanish silently', () => {
    const error = getError({ ...manifest('seo', [{ path: '/x', titel: 'X' } as never]), urlz: [] })

    expect(error.issues).toEqual([
      'urlz: unknown field; allowed: producer, version, generatedAt, urls',
      'urls[0] (/x).titel: unknown field; allowed: path, group, title, description, lastmod, llms, changefreq, priority',
    ])
  })

  it('validates in createManifest too, so a producer build fails before upload', () => {
    expect(() => {
      return createManifest('client', [{ path: '/x', priority: 5 }])
    }).toThrow(/Manifest client is invalid[\s\S]*priority: got 5/)
  })

  it('rejects an unknown manifest version', () => {
    expect(() => {
      return parseManifest({ ...manifest('seo', []), version: 2 }, 'seo.json')
    }).toThrow(/version: expected 1, got 2/)
  })

  it('rejects protocol-relative and fragment paths', () => {
    expect(() => {
      return createManifest('client', [{ path: '//evil.com/x' }])
    }).toThrow(/single "\/"/)
    expect(() => {
      return createManifest('client', [{ path: '/faq#top' }])
    }).toThrow(/fragment/)
  })
})

describe('mergeManifests', () => {
  it('keeps the first occurrence of a path and records the dropped one', () => {
    const { entries, duplicates } = mergeManifests([
      manifest('client', [{ path: '/', title: 'Home' }, { path: '/faq' }]),
      manifest('seo', [{ path: '/faq', title: 'FAQ from seo' }, { path: '/shows/eilat' }]),
    ])

    expect(
      entries.map((entry) => {
        return entry.path
      }),
    ).toEqual(['/', '/faq', '/shows/eilat'])
    expect(entries[1]?.title).toBeUndefined()
    expect(duplicates).toEqual([{ path: '/faq', keptFrom: 'client', droppedFrom: 'seo' }])
  })

  it('treats a trailing slash as a different path', () => {
    const { entries } = mergeManifests([manifest('client', [{ path: '/special/x' }, { path: '/special/x/' }])])

    expect(entries).toHaveLength(2)
  })
})

describe('findDisallowedEntries', () => {
  it('matches the prefix itself, its children and its query, not a longer sibling', () => {
    const found = findDisallowedEntries(
      [{ path: '/checkout' }, { path: '/checkout/step-2' }, { path: '/checkout?id=1' }, { path: '/checkout-info' }],
      config,
    )

    expect(found).toEqual([
      '/checkout (under disallowed /checkout)',
      '/checkout/step-2 (under disallowed /checkout)',
      '/checkout?id=1 (under disallowed /checkout)',
    ])
  })
})
