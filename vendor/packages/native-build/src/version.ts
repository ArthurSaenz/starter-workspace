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
