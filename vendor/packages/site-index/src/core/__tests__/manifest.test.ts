import { describe, expect, it } from 'vitest'

import { SiteIndexError } from '../errors.js'
import { createManifest, findDisallowedEntries, mergeManifests, parseManifest } from '../manifest.js'
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
      'urls[2] (/ok2).lastmod: got "yesterday", expected a W3C Datetime such as "2026-10-22" or "2026-10-22T09:11:00Z"',
    ])
  })

  it.each([
    '2026',
    '2026-10',
    '2026-10-22',
    '2026-10-22T09:11Z',
    '2026-10-22T09:11:00+03:00',
    '2026-10-22T09:11:00.5Z',
  ])('passes W3C Datetime lastmod %s through unchanged', (lastmod) => {
    expect(createManifest('special', [{ path: '/x', lastmod }]).urls).toEqual([{ path: '/x', lastmod }])
  })

  it.each([
    'March 5, 2026',
    '2026/10/22',
    '10/22/2026',
    '2026-10-22 09:11:00',
    '2026-10-22T09:11:00',
    '2026-02-30',
    '2026-10-22T24:00Z',
    '2026-10-22T09:60Z',
    '2026-10-22T09:11:60Z',
    '2026-10-22T09:11+24:00',
    '2026-10T09:11Z',
    '2026-10-22T09:11ZT00:00Z',
  ])('refuses lastmod %s, naming the producer and the path', (lastmod) => {
    expect(() => {
      return createManifest('special', [{ path: '/christmas-markets', lastmod }])
    }).toThrow(/Manifest special is invalid[\s\S]*urls\[0\] \(\/christmas-markets\)\.lastmod: got/)
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

  it('rejects a backslash, which URL parsing would read as the start of another host', () => {
    expect(new URL('/\\evil.com/x', 'https://www.hulyo.co.il').host).toBe('evil.com')
    expect(() => {
      return createManifest('client', [{ path: '/\\evil.com/x' }])
    }).toThrow(/backslash/)
  })

  it.each(['/a/../checkout/1', '/a/%2e%2e/checkout/1', '/a/.%2E/checkout', '/./checkout', '/checkout/..'])(
    'rejects the dot segment in %s, which would resolve past the disallow guard',
    (path) => {
      expect(() => {
        return createManifest('client', [{ path }])
      }).toThrow(/"\." or "\.\." segments/)
    },
  )

  it('keeps dots that are not a whole segment, and dot segments inside a query', () => {
    const paths = ['/.well-known/x', '/a..b', '/v1.2/x', '/search?next=/a/../b']

    expect(
      createManifest(
        'client',
        paths.map((path) => {
          return { path }
        }),
      ).urls,
    ).toHaveLength(paths.length)
  })

  it.each(['../seo', 'a/b', 'a\\b', '..', '.'])('rejects producer %s, which names the manifest file', (producer) => {
    expect(getError(manifest(producer, [])).issues).toEqual([`producer "${producer}": not usable as a file name`])
  })

  it('rejects an empty or non-string producer', () => {
    expect(getError(manifest('', [])).issues).toEqual(['producer: not a non-empty string'])
    expect(getError({ ...manifest('seo', []), producer: 7 }).issues).toEqual(['producer: not a non-empty string'])
  })

  it('reports a non-object entry and a non-string lastmod', () => {
    expect(getError({ ...manifest('seo', []), urls: ['/x', { path: '/y', lastmod: 20_261_022 }] }).issues).toEqual([
      'urls[0]: not an object',
      'urls[1] (/y).lastmod: got 20261022, expected a W3C Datetime such as "2026-10-22" or "2026-10-22T09:11:00Z"',
    ])
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

  it('matches a percent-encoded spelling of a disallowed prefix, and survives a malformed escape', () => {
    expect(findDisallowedEntries([{ path: '/%63heckout/1' }, { path: '/%E0%A4%A/x' }], config)).toEqual([
      '/%63heckout/1 (under disallowed /checkout)',
    ])
  })
})
