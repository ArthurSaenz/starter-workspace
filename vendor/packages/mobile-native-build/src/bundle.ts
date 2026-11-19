import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { CliError, EXIT_FAILURE } from './cli-error.ts'

const listScripts = (assetsDir: string): string[] => {
  try {
    return readdirSync(assetsDir).filter((file) => {
      return file.endsWith('.js')
    })
  } catch {
    return []
  }
}

/** Proves `cap sync` copied a bundle built for this domain, since its exit code is not trusted (see run.ts). */
export const assertSyncedBundle = (assetsDir: string, remoteEntry: string, log: (line: string) => void): void => {
  const synced = listScripts(assetsDir).some((file) => {
    return readFileSync(resolve(assetsDir, file), 'utf8').includes(remoteEntry)
  })

  if (!synced) throw new CliError(`${assetsDir} does not reference ${remoteEntry}`, EXIT_FAILURE)

  log(`✓ ${assetsDir} → ${remoteEntry}`)
}
