import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseJson } from '../core/json.js'
import { parseManifest } from '../core/manifest.js'
import type { SiteIndexFileName, SiteIndexFiles, SiteIndexManifest } from '../core/types.js'

const MANIFEST_EXTENSION = '.json'

export const getManifestFileName = (producer: string): string => {
  return `${producer}${MANIFEST_EXTENSION}`
}

// A deploy uploads these files: a crash mid-write must leave the previous file, not half of the new one.
const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
  // Unique per call: two writes of one file in one process must not share a temp file.
  const tempPath = `${filePath}.${randomUUID()}.tmp`

  try {
    await writeFile(tempPath, content)
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })

    throw error
  }
}

/** Writes `<dir>/<producer>.json`, the file a deploy uploads to `manifests/` in the site-index bucket. */
export const writeManifest = async (dir: string, manifest: SiteIndexManifest): Promise<string> => {
  const filePath = join(dir, getManifestFileName(manifest.producer))

  await mkdir(dir, { recursive: true })
  await writeFileAtomic(filePath, `${JSON.stringify(manifest, null, 2)}\n`)

  return filePath
}

export const readManifests = async (dir: string): Promise<SiteIndexManifest[]> => {
  const names = (await readdir(dir))
    .filter((name) => {
      return name.endsWith(MANIFEST_EXTENSION)
    })
    .sort()

  return Promise.all(
    names.map(async (name) => {
      const filePath = join(dir, name)

      return parseManifest(parseJson(await readFile(filePath, 'utf8'), filePath), filePath)
    }),
  )
}

/** Local preview of what the aggregator publishes; deploys never upload these files. */
export const writeSiteIndexFiles = async (dir: string, files: SiteIndexFiles): Promise<string[]> => {
  await mkdir(dir, { recursive: true })

  return Promise.all(
    (Object.keys(files) as SiteIndexFileName[]).map(async (name) => {
      const filePath = join(dir, name)

      await writeFileAtomic(filePath, files[name])

      return filePath
    }),
  )
}
