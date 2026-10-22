import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createManifest } from '../../core/manifest.js'
import { readManifests, writeManifest, writeSiteIndexFiles } from '../index.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'site-index-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('node helpers', () => {
  it('round-trips manifests sorted by file name and ignores non-json files', async () => {
    await writeManifest(dir, createManifest('seo', [{ path: '/shows' }]))
    await writeManifest(dir, createManifest('client', [{ path: '/' }]))
    await writeFile(join(dir, 'notes.txt'), 'ignored')

    const manifests = await readManifests(dir)

    expect(
      manifests.map((manifest) => {
        return manifest.producer
      }),
    ).toEqual(['client', 'seo'])
  })

  it('names the file in a parse error', async () => {
    await writeFile(
      join(dir, 'broken.json'),
      JSON.stringify({ producer: 'broken', version: 1, generatedAt: 'x', urls: [{}] }),
    )

    await expect(readManifests(dir)).rejects.toThrow(join(dir, 'broken.json'))
  })

  it('writes the three public files', async () => {
    const out = join(dir, 'out')

    await writeSiteIndexFiles(out, { 'sitemap.xml': '<x/>', 'robots.txt': 'r', 'llms.txt': 'l' })

    expect(await readFile(join(out, 'llms.txt'), 'utf8')).toBe('l')
  })
})
