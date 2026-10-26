import { describe, expect, it } from 'vitest'

import { buildSiteIndex, getShrinkRefusal } from '../build.js'
import { config, manifest } from './fixtures.js'

describe('buildSiteIndex', () => {
  it('merges producers in name order regardless of input order', () => {
    const { files, stats } = buildSiteIndex(
      config,
      [
        manifest('seo', [{ path: '/shows/eilat', group: 'shows' }, { path: '/' }]),
        manifest('client', [{ path: '/' }, { path: '/hidden', llms: false }]),
      ],
      { crawlable: true },
    )

    expect(stats).toEqual({
      urlCount: 3,
      llmsUrlCount: 2,
      producers: { client: 2, seo: 2 },
      duplicates: [{ path: '/', keptFrom: 'client', droppedFrom: 'seo' }],
    })
    expect(files['sitemap.xml'].indexOf('/hidden')).toBeLessThan(files['sitemap.xml'].indexOf('/shows/eilat'))
    expect(files['llms.txt']).toContain('/shows/eilat')
    expect(files['llms.txt']).not.toContain('/hidden')
    expect(files['robots.txt']).toContain('Sitemap:')
  })

  it('groups bare paths by config prefix, keeping a group the producer set', () => {
    const { files } = buildSiteIndex(
      { ...config, llms: { ...config.llms, groupPrefixes: { flights: ['/budget/Flights_to_'], legal: ['/terms'] } } },
      [
        manifest('wp', [
          { path: '/budget/Flights_to_Rome', title: 'Rome' },
          { path: '/budget/Flights_to_Paris', title: 'Paris', group: 'shows' },
          { path: '/terms', title: 'Terms' },
          { path: '/misc', title: 'Misc' },
        ]),
      ],
      { crawlable: true },
    )

    const llms = files['llms.txt']

    expect(llms.indexOf('[Rome]')).toBeGreaterThan(llms.indexOf('## Flights'))
    expect(llms.indexOf('[Paris]')).toBeGreaterThan(llms.indexOf('## Shows'))
    expect(llms.indexOf('[Terms]')).toBeGreaterThan(llms.indexOf('## Optional'))
    expect(llms.indexOf('[Misc]')).toBeLessThan(llms.indexOf('## Flights'))
  })

  it('fails on a disallowed path', () => {
    expect(() => {
      return buildSiteIndex(config, [manifest('client', [{ path: '/api/health' }])], { crawlable: true })
    }).toThrow(/\/api\/health \(under disallowed \/api\)/)
  })

  it('fails when two manifests claim one producer', () => {
    expect(() => {
      return buildSiteIndex(config, [manifest('client', []), manifest('client', [])], { crawlable: true })
    }).toThrow(/same producer/)
  })
})

describe('getShrinkRefusal', () => {
  it('passes the first run and drops within the limit', () => {
    expect(getShrinkRefusal(undefined, 0)).toBeNull()
    expect(getShrinkRefusal(100, 70)).toBeNull()
    expect(getShrinkRefusal(100, 150)).toBeNull()
  })

  it('refuses a drop past the limit', () => {
    expect(getShrinkRefusal(114, 54)).toMatch(/fell from 114 to 54 \(-53%\), above the 30% limit/)
    expect(getShrinkRefusal(100, 89, 0.1)).toMatch(/above the 10% limit/)
  })
})
