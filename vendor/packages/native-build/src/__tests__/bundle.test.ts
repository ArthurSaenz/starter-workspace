import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { assertSyncedBundle } from '../bundle.ts'

const REMOTE_ENTRY = 'https://dev.example.com/mfe/remoteEntry.js'

const createAssets = (files: Record<string, string>): string => {
  const dir = resolve(mkdtempSync(resolve(tmpdir(), 'native-build-bundle-')), 'assets')

  mkdirSync(dir)

  for (const [name, content] of Object.entries(files)) writeFileSync(resolve(dir, name), content)

  return dir
}

describe('assertSyncedBundle', () => {
  it('passes when a script references the remote entry', () => {
    const dir = createAssets({ 'index.css': REMOTE_ENTRY, 'index-a1.js': `import("${REMOTE_ENTRY}")` })
    const log = vi.fn()

    assertSyncedBundle(dir, REMOTE_ENTRY, log)

    expect(log).toHaveBeenCalledWith(`✓ ${dir} → ${REMOTE_ENTRY}`)
  })

  it.each([
    ['a bundle built for another domain', { 'index-a1.js': 'import("https://www.example.com/mfe/remoteEntry.js")' }],
    ['an empty dir', {}],
    ['a non-script file only', { 'index.css': REMOTE_ENTRY }],
  ])('exits 1 naming the dir and the URL for %s', (_name, files) => {
    const dir = createAssets(files)

    expect(() => {
      assertSyncedBundle(dir, REMOTE_ENTRY, vi.fn())
    }).toThrow(expect.objectContaining({ exitCode: 1, message: `${dir} does not reference ${REMOTE_ENTRY}` }))
  })

  it('exits 1 when the dir does not exist', () => {
    expect(() => {
      assertSyncedBundle('/nonexistent/assets', REMOTE_ENTRY, vi.fn())
    }).toThrow(expect.objectContaining({ exitCode: 1 }))
  })
})
