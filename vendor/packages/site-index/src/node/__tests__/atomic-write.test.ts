import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifest } from '../../core/manifest.js'
import { writeManifest } from '../index.js'

const disk = vi.hoisted(() => {
  return { isFull: false }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()

  return {
    ...actual,
    // A full disk: part of the content lands, then the write fails.
    writeFile: async (path: string, content: string) => {
      if (!disk.isFull) return actual.writeFile(path, content)

      await actual.writeFile(path, content.slice(0, 10))

      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    },
  }
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'site-index-atomic-'))
})

afterEach(async () => {
  disk.isFull = false
  await rm(dir, { recursive: true, force: true })
})

describe('writeManifest', () => {
  it('keeps the previous manifest whole and leaves no temp file when a write fails midway', async () => {
    const filePath = await writeManifest(dir, createManifest('client', [{ path: '/' }]))
    const previous = await readFile(filePath, 'utf8')

    disk.isFull = true

    await expect(writeManifest(dir, createManifest('client', [{ path: '/' }, { path: '/faq' }]))).rejects.toThrow(
      'ENOSPC',
    )
    expect(await readFile(filePath, 'utf8')).toBe(previous)
    expect(await readdir(dir)).toEqual(['client.json'])
  })
})
