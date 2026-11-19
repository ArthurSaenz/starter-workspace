import type { Buffer } from 'node:buffer'

import { CliError } from './cli-error.ts'
import type { Exec } from './exec.ts'
import type { Delivered, HistoryEntry, NativeStamps, Stamp } from './version.ts'
import { parseAndroid, parseIos } from './version.ts'

// main is what ships to the stores in both git flows, and Play accepts any `versionName`, so a delivered
// marketing version is only detectable here.
export const DELIVERED_REF = 'origin/main'

export interface NativePaths {
  gradle: string
  pbxproj: string
}

export interface GitState {
  head: NativeStamps
  history: HistoryEntry[]
  delivered: Delivered | undefined
}

const git = (exec: Exec, cwd: string, args: string[], input?: string) => {
  return exec('git', args, { cwd, capture: true, ...(input === undefined ? {} : { input }) })
}

const gitText = (exec: Exec, cwd: string, args: string[]): string => {
  const result = git(exec, cwd, args)

  if (result.status !== 0) {
    throw new CliError(`git ${args.join(' ')} exited with ${result.status}: ${result.stderr.toString().trim()}`)
  }

  return result.stdout.toString()
}

export const fetchOrigin = (exec: Exec, cwd: string, log: (line: string) => void): void => {
  log('$ git fetch origin --quiet')

  const { status } = exec('git', ['fetch', 'origin', '--quiet'], { cwd })

  if (status !== 0)
    throw new CliError(`git fetch origin failed (exit ${status}): the version is derived from fetched history`)
}

const parseBatch = (output: Buffer, count: number): (string | undefined)[] => {
  const blobs: (string | undefined)[] = []
  let offset = 0

  while (blobs.length < count) {
    const lineEnd = output.indexOf('\n', offset)

    if (lineEnd === -1) throw new CliError('git cat-file --batch ended early')

    const header = output.subarray(offset, lineEnd).toString()

    offset = lineEnd + 1

    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      blobs.push(undefined)
      continue
    }

    const size = Number(header.split(' ')[2])

    blobs.push(output.subarray(offset, offset + size).toString())
    offset += size + 1
  }

  return blobs
}

const tryParse = (parse: (source: string) => Stamp, source: string | undefined): Stamp | undefined => {
  if (source === undefined) return undefined

  try {
    return parse(source)
  } catch {
    return undefined
  }
}

const shortRef = (ref: string): string => {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '')
}

export const readGitState = (exec: Exec, cwd: string, paths: NativePaths): GitState => {
  const prefix = gitText(exec, cwd, ['rev-parse', '--show-prefix']).trim()
  const pathspecs = [paths.gradle, paths.pbxproj]

  const commits = gitText(exec, cwd, [
    'log',
    '--full-history',
    '--branches',
    '--remotes=origin',
    '--source',
    '--format=%H %S',
    '--',
    ...pathspecs,
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', ref = ''] = line.split(' ')

      return { sha, source: `${shortRef(ref)} (${sha.slice(0, 9)})` }
    })

  const deliveredLog = git(exec, cwd, [
    'log',
    '-1',
    '--first-parent',
    '--format=%h %cs',
    DELIVERED_REF,
    '--',
    ...pathspecs,
  ])

  const deliveredCommit = deliveredLog.status === 0 ? deliveredLog.stdout.toString().trim() : undefined

  const revisions = [
    'HEAD',
    ...(deliveredCommit === undefined ? [] : [DELIVERED_REF]),
    ...commits.map(({ sha }) => {
      return sha
    }),
  ]

  const requests = revisions.flatMap((revision) => {
    return [`${revision}:${prefix}${paths.gradle}`, `${revision}:${prefix}${paths.pbxproj}`]
  })

  const batch = git(exec, cwd, ['cat-file', '--batch'], `${requests.join('\n')}\n`)

  if (batch.status !== 0) throw new CliError(`git cat-file --batch exited with ${batch.status}`)

  const blobs = parseBatch(batch.stdout, requests.length)

  const stampsAt = (index: number) => {
    return { android: tryParse(parseAndroid, blobs[index * 2]), ios: tryParse(parseIos, blobs[index * 2 + 1]) }
  }

  const head = stampsAt(0)

  if (!head.android || !head.ios) {
    throw new CliError(`HEAD has no committed version in ${prefix}${paths.gradle} and ${prefix}${paths.pbxproj}`)
  }

  const historyOffset = deliveredCommit === undefined ? 1 : 2
  const [commit = '', date = ''] = (deliveredCommit ?? '').split(' ')

  return {
    head: { android: head.android, ios: head.ios },
    history: commits.map(({ source }, index) => {
      return { source, ...stampsAt(index + historyOffset) }
    }),
    delivered: deliveredCommit === undefined ? undefined : { ref: DELIVERED_REF, commit, date, ...stampsAt(1) },
  }
}
