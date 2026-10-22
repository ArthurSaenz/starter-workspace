import type { SiteIndexConfig, SiteIndexEntry, SiteIndexManifest } from '../types.js'
import { MANIFEST_VERSION } from '../types.js'

export const config: SiteIndexConfig = {
  name: 'Hulyo',
  origin: 'https://www.hulyo.co.il',
  disallow: ['/checkout', '/api'],
  robots: { aiBots: ['GPTBot', 'OAI-SearchBot'] },
  llms: {
    summary: 'Israeli travel deals.',
    details: ['Prices change often; do not present them as guaranteed.'],
    sections: [
      { group: 'flights', title: 'Flights' },
      { group: 'shows', title: 'Shows' },
    ],
    optionalGroups: ['legal'],
  },
  defaults: { changefreq: 'daily', priority: 1 },
}

export const manifest = (producer: string, urls: SiteIndexEntry[]): SiteIndexManifest => {
  return { producer, version: MANIFEST_VERSION, generatedAt: '2026-10-22T00:00:00.000Z', urls }
}
