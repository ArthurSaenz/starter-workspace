import { CliError } from './cli-error.ts'

export interface Stamp {
  version: string
  build: number
}

// Whole lines only: a commented-out `// versionCode 1` above the real one must be neither parsed nor stamped.
// `[ \t]` rather than `\s`, which would let `^` match on a blank line above and swallow the newline.
const ANDROID_CODE = /^([ \t]*)versionCode (?<value>\d+)[ \t]*$/m
const ANDROID_NAME = /^([ \t]*)versionName "(?<value>[^"\n]+)"[ \t]*$/m
const IOS_BUILD = /^([ \t]*)CURRENT_PROJECT_VERSION = (?<value>\d+);[ \t]*$/m
const IOS_VERSION = /^([ \t]*)MARKETING_VERSION = (?<value>[^;\n]+);[ \t]*$/m

const match = (source: string, pattern: RegExp, file: string): string => {
  const { value } = pattern.exec(source)?.groups ?? {}

  if (value === undefined) throw new CliError(`${file}: pattern not found: ${pattern}`)

  return value
}

const replaceAll = (source: string, pattern: RegExp, replacement: string, file: string): string => {
  if (!pattern.test(source)) throw new CliError(`${file}: pattern not found: ${pattern}`)

  return source.replaceAll(new RegExp(pattern.source, `${pattern.flags}g`), `$1${replacement}`)
}

export const parseAndroid = (gradle: string): Stamp => {
  return {
    version: match(gradle, ANDROID_NAME, 'build.gradle'),
    build: Number(match(gradle, ANDROID_CODE, 'build.gradle')),
  }
}

export const parseIos = (pbxproj: string): Stamp => {
  return {
    version: match(pbxproj, IOS_VERSION, 'project.pbxproj'),
    build: Number(match(pbxproj, IOS_BUILD, 'project.pbxproj')),
  }
}

export const stampAndroid = (gradle: string, { version, build }: Stamp): string => {
  const next = replaceAll(gradle, ANDROID_CODE, `versionCode ${build}`, 'build.gradle')

  return replaceAll(next, ANDROID_NAME, `versionName "${version}"`, 'build.gradle')
}

export const stampIos = (pbxproj: string, { version, build }: Stamp): string => {
  const next = replaceAll(pbxproj, IOS_BUILD, `CURRENT_PROJECT_VERSION = ${build};`, 'project.pbxproj')

  return replaceAll(next, IOS_VERSION, `MARKETING_VERSION = ${version};`, 'project.pbxproj')
}

export type Platform = 'android' | 'ios'

export type NativeStamps = Record<Platform, Stamp>

export interface HistoryEntry {
  source: string
  android: Stamp | undefined
  ios: Stamp | undefined
}

export interface BuildPick {
  build: number
  source: string
}

export interface Derivation {
  major: number
  version: string
  android: BuildPick
  ios: BuildPick
}

export type Delivered =
  | { state: 'no-ref'; ref: string }
  | { state: 'unreadable'; ref: string; problems: string[] }
  | { state: 'found'; ref: string; commit: string; date: string; android: Stamp; ios: Stamp }

export const majorOf = (version: string): number => {
  return Number.parseInt(version, 10)
}

const PLATFORMS: Platform[] = ['android', 'ios']

const headMajor = (head: NativeStamps): number => {
  const android = majorOf(head.android.version)
  const ios = majorOf(head.ios.version)

  if (android !== ios || Number.isNaN(android)) {
    throw new CliError(
      `HEAD's majors disagree: Android ${head.android.version}, iOS ${head.ios.version}; fix the committed native files`,
    )
  }

  return android
}

const devVersion = (major: number, versions: string[]): string => {
  const pattern = new RegExp(`^${major}\\.9\\.(\\d+)$`)

  const patches = versions.flatMap((version) => {
    const patch = pattern.exec(version)?.[1]

    return patch === undefined ? [] : [Number(patch)]
  })

  return `${major}.9.${patches.length > 0 ? Math.max(...patches) + 1 : 9}`
}

const nextBuild = (platform: Platform, head: NativeStamps, history: HistoryEntry[]): BuildPick => {
  let max: BuildPick = { build: head[platform].build, source: 'HEAD' }

  for (const entry of history) {
    const stamp = entry[platform]

    if (stamp && stamp.build > max.build) max = { build: stamp.build, source: entry.source }
  }

  return { build: max.build + 1, source: max.source }
}

export const nextVersion = (
  env: 'dev' | 'prod',
  head: NativeStamps,
  history: HistoryEntry[],
  override?: string,
): Derivation => {
  const major = headMajor(head)

  if (override !== undefined && majorOf(override) < major) {
    throw new CliError(`--version ${override} is below HEAD's major ${major}`)
  }

  const versions = [head, ...history].flatMap((entry) => {
    return PLATFORMS.flatMap((platform) => {
      const stamp = entry[platform]

      return stamp ? [stamp.version] : []
    })
  })

  const derived = env === 'dev' ? devVersion(major, versions) : `${major}.0.0`

  return {
    major,
    version: override ?? derived,
    android: nextBuild('android', head, history),
    ios: nextBuild('ios', head, history),
  }
}

export const nextMajorHint = (major: number): string => {
  return `next major: pnpm run build-native-prod --version ${major + 1}.0.0`
}

const VERSION_PARTS = /^(\d+)\.(\d+)\.(\d+)$/

/** Negative, zero or positive as `a` is below, equal to or above `b`; `undefined` when either is not x.y.z. */
export const compareVersions = (a: string, b: string): number | undefined => {
  const left = VERSION_PARTS.exec(a)?.slice(1).map(Number)
  const right = VERSION_PARTS.exec(b)?.slice(1).map(Number)

  if (!left || !right) return undefined

  const index = left.findIndex((part, position) => {
    return part !== right[position]
  })

  return index === -1 ? 0 : (left[index] ?? 0) - (right[index] ?? 0)
}

const prodRefusal = (headline: string, version: string, major: number): CliError => {
  return new CliError(
    [
      headline,
      `Start the next major:   pnpm run build-native-prod --version ${major + 1}.0.0`,
      `Rebuild ${version} anyway:  pnpm run build-native-prod --version ${version}`,
    ].join('\n'),
  )
}

const describeDelivered = ({ android, ios }: { android: Stamp; ios: Stamp }): string => {
  return android.version === ios.version ? android.version : `${android.version} (iOS ${ios.version})`
}

type FoundDelivered = Extract<Delivered, { state: 'found' }>

const assertProdAboveDelivered = (version: string, major: number, delivered: FoundDelivered, where: string): void => {
  const comparisons = [delivered.android.version, delivered.ios.version].map((deliveredVersion) => {
    return { deliveredVersion, order: compareVersions(version, deliveredVersion) }
  })

  if (
    comparisons.some(({ order }) => {
      return order === 0
    })
  ) {
    throw prodRefusal(`prod ${version} is already delivered on ${where}.`, version, major)
  }

  for (const { deliveredVersion, order } of comparisons) {
    if (order === undefined) {
      throw prodRefusal(`cannot compare prod ${version} with "${deliveredVersion}" on ${where}.`, version, major)
    }

    if (order < 0) {
      throw prodRefusal(`prod ${version} is below the delivered ${deliveredVersion} on ${where}.`, version, major)
    }
  }
}

const assertFoundLine = (
  env: 'dev' | 'prod',
  { version, major }: Derivation,
  override: string | undefined,
  delivered: FoundDelivered,
): string | undefined => {
  const where = `${delivered.ref} (${delivered.commit}, ${delivered.date})`

  const majors = [delivered.android.version, delivered.ios.version].flatMap((deliveredVersion) => {
    return VERSION_PARTS.test(deliveredVersion) ? [majorOf(deliveredVersion)] : []
  })

  if (majors.length === 0) {
    const unreadable = `${where} holds no x.y.z version (${describeDelivered(delivered)})`

    if (override !== undefined) return `--version ${override} is not checked against the delivered line: ${unreadable}`

    if (env === 'prod') throw prodRefusal(`cannot verify the delivered version: ${unreadable}.`, version, major)

    throw new CliError(`cannot verify the delivered version: ${unreadable}.\nPass --version to stamp one explicitly.`)
  }

  const deliveredMajor = Math.max(...majors)

  if (override !== undefined) {
    if (majorOf(override) < deliveredMajor) {
      throw new CliError(`--version ${override} is below the delivered major ${deliveredMajor} on ${where}`)
    }

    return undefined
  }

  if (deliveredMajor > major) {
    throw new CliError(
      `this branch is behind the delivered version: HEAD is at major ${major}, ${where} holds ${describeDelivered(delivered)}.\n` +
        'Merge the integration branch into this branch first, or pass --version.',
    )
  }

  if (env === 'prod') assertProdAboveDelivered(version, major, delivered, where)

  return undefined
}

/**
 * Play accepts any `versionName`, so nothing downstream stops a plain run from stamping a version at or below the
 * one `origin/main` delivered. Only the delivered line counts: an undelivered higher major on a parallel release
 * branch must not block this one. Returns a notice when `--version` could not be checked against it.
 */
export const assertDeliveredLine = (
  env: 'dev' | 'prod',
  derivation: Derivation,
  override: string | undefined,
  delivered: Delivered,
): string | undefined => {
  if (delivered.state === 'found') return assertFoundLine(env, derivation, override, delivered)

  if (env === 'dev' || override !== undefined) return undefined

  const reason =
    delivered.state === 'no-ref' ? `no ${delivered.ref}` : `${delivered.ref}: ${delivered.problems.join(', ')}`

  throw prodRefusal(`cannot verify the delivered version: ${reason}`, derivation.version, derivation.major)
}

/**
 * A prod stamp of a higher major committed on any branch may already be in the stores ahead of main; stamping a
 * lower prod version after it would pass Play silently. Dev builds stay free to run on parallel branches.
 */
export const assertNoHigherProdStamp = (
  env: 'dev' | 'prod',
  { major }: Derivation,
  override: string | undefined,
  history: HistoryEntry[],
): void => {
  if (env !== 'prod' || override !== undefined) return

  let highest: { version: string; source: string } | undefined

  for (const entry of history) {
    for (const platform of PLATFORMS) {
      const version = entry[platform]?.version

      if (version === undefined || !/^\d+\.0\.0$/.test(version) || majorOf(version) <= major) continue

      if (!highest || majorOf(version) > majorOf(highest.version)) highest = { version, source: entry.source }
    }
  }

  if (highest) {
    throw new CliError(
      `a committed prod ${highest.version} above HEAD's major ${major} is on ${highest.source}.\n` +
        'Merge that line into this branch first, or pass --version.',
    )
  }
}

export type WorkingTreeAction = 'stamp' | 'unchanged'

export interface WorkingTreeFile {
  source: string
  head: Stamp
}

const STAMPERS: Record<Platform, (source: string, stamp: Stamp) => string> = {
  android: stampAndroid,
  ios: stampIos,
}

/**
 * Derivation reads committed state only, so a stamp left uncommitted by an earlier run must be either this
 * run's own stamp (a re-run) or nothing at all; anything else may be an uploaded build.
 */
export const checkWorkingTree = (
  files: Record<Platform, WorkingTreeFile>,
  computed: NativeStamps,
  nativePaths: string[],
): Record<Platform, WorkingTreeAction> => {
  const actionFor = (platform: Platform): WorkingTreeAction | undefined => {
    const { source, head } = files[platform]
    const stamp = STAMPERS[platform]

    if (stamp(source, computed[platform]) === source) return 'unchanged'

    if (stamp(source, head) === source) return 'stamp'

    return undefined
  }

  const android = actionFor('android')
  const ios = actionFor('ios')

  if (android && ios) return { android, ios }

  const found = { android: parseAndroid(files.android.source), ios: parseIos(files.ios.source) }

  const versions =
    found.android.version === found.ios.version
      ? found.android.version
      : `${found.android.version} / iOS ${found.ios.version}`

  throw new CliError(
    `a previous stamp (${versions}, iOS ${found.ios.build} / Android ${found.android.build}) is uncommitted: commit it if that build was uploaded, otherwise \`git checkout -- ${nativePaths.join(' ')}\``,
  )
}
