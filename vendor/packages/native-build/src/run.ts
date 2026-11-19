import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { CliArgs } from './args.ts'
import { USAGE, parseCliArgs } from './args.ts'
import { assertSyncedBundle } from './bundle.ts'
import { CliError, EXIT_FAILURE } from './cli-error.ts'
import { resolveDomain } from './domain.ts'
import type { Exec } from './exec.ts'
import { fetchOrigin, readGitState } from './git-state.ts'
import {
  assertDeliveredLine,
  checkWorkingTree,
  majorOf,
  nextMajorHint,
  nextVersion,
  stampAndroid,
  stampIos,
} from './version.ts'

export const GRADLE_PATH = 'android/app/build.gradle'
export const PBXPROJ_PATH = 'ios/App/App.xcodeproj/project.pbxproj'
const IOS_ASSETS_PATH = 'ios/App/App/public/assets'
const ANDROID_ASSETS_PATH = 'android/app/src/main/assets/public/assets'

export const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'

export interface RunDeps {
  exec: Exec
  cwd: string
  env: NodeJS.ProcessEnv
  log: (line: string) => void
  warn: (line: string) => void
  error: (line: string) => void
  xcodeDeveloperDir: string
}

interface App {
  appDir: string
  repoRoot: string
  name: string
}

const findRepoRoot = (from: string): string => {
  let dir = from

  while (!existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)

    if (parent === dir) throw new CliError(`no pnpm-workspace.yaml above ${from}`)

    dir = parent
  }

  return dir
}

const resolveApp = (appDir: string): App => {
  for (const file of [GRADLE_PATH, PBXPROJ_PATH, 'package.json']) {
    if (!existsSync(resolve(appDir, file))) {
      throw new CliError(`${appDir} has no ${file}: run this from the Capacitor app directory`)
    }
  }

  const manifest = JSON.parse(readFileSync(resolve(appDir, 'package.json'), 'utf8')) as {
    name?: string
    scripts?: Record<string, string>
  }

  for (const script of ['_build', 'sync']) {
    if (!manifest.scripts?.[script]) throw new CliError(`${appDir}/package.json has no "${script}" script`)
  }

  if (!manifest.name) throw new CliError(`${appDir}/package.json has no name`)

  return { appDir, repoRoot: findRepoRoot(appDir), name: manifest.name }
}

const formatVersions = (android: string, ios: string): string => {
  return android === ios ? android : `${android} (iOS ${ios})`
}

const NATIVE_PATHS = [GRADLE_PATH, PBXPROJ_PATH]

export const runBuild = (args: CliArgs, deps: RunDeps): void => {
  const { exec, log, warn } = deps
  const app = resolveApp(deps.cwd)
  const { VITE_MOBILE_DOMAIN_URL: envDomain } = deps.env
  const origin = resolveDomain(args.domain, envDomain)
  const remoteEntry = `${origin}/mfe/remoteEntry.js`

  fetchOrigin(exec, app.appDir, log)

  const { head, history, delivered } = readGitState(exec, app.appDir, { gradle: GRADLE_PATH, pbxproj: PBXPROJ_PATH })
  const derivation = nextVersion(args.env, head, history, args.version)

  assertDeliveredLine(args.env, derivation, args.version, delivered)

  const gradleFile = resolve(app.appDir, GRADLE_PATH)
  const pbxprojFile = resolve(app.appDir, PBXPROJ_PATH)
  const gradle = readFileSync(gradleFile, 'utf8')
  const pbxproj = readFileSync(pbxprojFile, 'utf8')
  const android = { version: derivation.version, build: derivation.android.build }
  const ios = { version: derivation.version, build: derivation.ios.build }

  const actions = checkWorkingTree(
    { android: { source: gradle, head: head.android }, ios: { source: pbxproj, head: head.ios } },
    { android, ios },
    NATIVE_PATHS,
  )

  log(
    `${args.env} · ${formatVersions(head.android.version, head.ios.version)} → ${derivation.version} · iOS ${ios.build} · Android ${android.build} · ${origin} · builds after iOS ${derivation.ios.source}, Android ${derivation.android.source}`,
  )

  if (args.dryRun) {
    log(nextMajorHint(Math.max(derivation.major, majorOf(derivation.version))))

    return
  }

  if (actions.android === 'stamp') writeFileSync(gradleFile, stampAndroid(gradle, android))

  if (actions.ios === 'stamp') writeFileSync(pbxprojFile, stampIos(pbxproj, ios))

  const childEnv = { ...deps.env, VITE_MOBILE_DOMAIN_URL: origin }

  const run = (file: string, argv: string[], cwd: string, env: NodeJS.ProcessEnv = childEnv): number => {
    log(`\n$ ${[file, ...argv].join(' ')}`)

    return exec(file, argv, { cwd, env }).status
  }

  const runOrFail = (file: string, argv: string[], cwd: string): void => {
    const status = run(file, argv, cwd)

    if (status !== 0) throw new CliError(`${file} ${argv.join(' ')} exited with ${status}`, EXIT_FAILURE)
  }

  runOrFail('pnpm', ['exec', 'turbo', 'build', `--filter=${app.name}^...`, '--output-logs=errors-only'], app.repoRoot)
  runOrFail('pnpm', ['run', '_build'], app.appDir)

  // `cap sync` = copy + update; update ends with `xcodebuild clean`, which fails on an Xcode plug-in mismatch
  // AFTER the copy and pod install are done. Tolerate it; the bundle assertion below verifies the copy.
  const syncEnv = existsSync(deps.xcodeDeveloperDir) ? { ...childEnv, DEVELOPER_DIR: deps.xcodeDeveloperDir } : childEnv
  const syncStatus = run('pnpm', ['run', 'sync'], app.appDir, syncEnv)

  if (syncStatus !== 0) warn(`\ncap sync exited with ${syncStatus}; checking the copied bundle anyway`)

  assertSyncedBundle(resolve(app.appDir, IOS_ASSETS_PATH), remoteEntry, log)
  assertSyncedBundle(resolve(app.appDir, ANDROID_ASSETS_PATH), remoteEntry, log)

  log(`\nDone. Archive in Xcode (pnpm ios) / Android Studio (pnpm android) as ${derivation.version}.`)
  log(
    `review \`git diff -- ${NATIVE_PATHS.join(' ')}\` first: \`cap sync\` may have changed more than the version lines`,
  )
  log(
    `git commit -m "[APP] Stamp ${app.name} ${derivation.version} for the ${args.env} native build (Android ${android.build}, iOS build ${ios.build})" -- ${NATIVE_PATHS.join(' ')}`,
  )
}

export const main = (argv: string[], deps: RunDeps): number => {
  try {
    const args = parseCliArgs(argv)

    if (args.help) {
      deps.log(USAGE)

      return 0
    }

    runBuild(args, deps)

    return 0
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error))

    return error instanceof CliError ? error.exitCode : EXIT_FAILURE
  }
}
