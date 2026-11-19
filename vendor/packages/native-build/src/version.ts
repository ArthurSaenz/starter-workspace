import { CliError } from './cli-error.ts'

export interface Stamp {
  version: string
  build: number
}

const ANDROID_CODE = /versionCode (\d+)/
const ANDROID_NAME = /versionName "([^"]+)"/
const IOS_BUILD = /CURRENT_PROJECT_VERSION = (\d+);/
const IOS_VERSION = /MARKETING_VERSION = ([^;]+);/

const match = (source: string, pattern: RegExp, file: string): string => {
  const value = pattern.exec(source)?.[1]

  if (value === undefined) throw new CliError(`${file}: pattern not found: ${pattern}`)

  return value
}

const replaceAll = (source: string, pattern: RegExp, replacement: string, file: string): string => {
  if (!pattern.test(source)) throw new CliError(`${file}: pattern not found: ${pattern}`)

  return source.replaceAll(new RegExp(pattern.source, 'g'), replacement)
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

export interface Delivered {
  ref: string
  commit: string
  date: string
  android: Stamp | undefined
  ios: Stamp | undefined
}

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
  // HEAD first and a strict `>` below: a tie reports HEAD as the source.
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

const guardRefusal = (headline: string, version: string, major: number): CliError => {
  return new CliError(
    [
      headline,
      `Start the next major:   pnpm run build-native-prod --version ${major + 1}.0.0`,
      `Rebuild ${version} anyway:  pnpm run build-native-prod --version ${version}`,
      nextMajorHint(major),
    ].join('\n'),
  )
}

/** Play accepts any `versionName`, so a plain prod run must not silently re-stamp an already delivered `N.0.0`. */
export const assertNotDelivered = (
  env: 'dev' | 'prod',
  derivation: Derivation,
  hasOverride: boolean,
  delivered: Delivered | undefined,
): void => {
  if (env !== 'prod' || hasOverride) return

  const { version, major } = derivation

  if (!delivered) throw guardRefusal('cannot verify the delivered version: no origin/main', version, major)

  if (delivered.android?.version === version || delivered.ios?.version === version) {
    throw guardRefusal(
      `prod ${version} is already delivered on ${delivered.ref} (${delivered.commit}, ${delivered.date}).`,
      version,
      major,
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
