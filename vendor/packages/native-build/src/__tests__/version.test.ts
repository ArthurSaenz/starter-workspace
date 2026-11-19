import { describe, expect, it } from 'vitest'

import { CliError } from '../cli-error.ts'
import { parseAndroid, parseIos, stampAndroid, stampIos } from '../version.ts'
import { readFixture } from './fixture-app.ts'

const changedLines = (before: string, after: string): number => {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  expect(afterLines).toHaveLength(beforeLines.length)

  return afterLines.filter((line, index) => {
    return line !== beforeLines[index]
  }).length
}

const FIXTURES = [
  {
    repo: 'hulyo',
    android: { version: '10.0.0', build: 2000000040 },
    ios: { version: '10.0.0', build: 5062 },
    occurrences: 4,
  },
  {
    repo: 'travelist',
    android: { version: '10.0.0', build: 50038 },
    ios: { version: '10.0.0', build: 5038 },
    occurrences: 2,
  },
]

describe.each(FIXTURES)('$repo native files', ({ repo, android, ios, occurrences }) => {
  const gradle = readFixture(`${repo}-build.gradle`)
  const pbxproj = readFixture(`${repo}-project.pbxproj`)
  const next = { version: '10.9.14', build: 7000 }

  it('parses both platforms', () => {
    expect(parseAndroid(gradle)).toEqual(android)
    expect(parseIos(pbxproj)).toEqual(ios)
  })

  it('stamps only the version lines: occurrences × 2 in pbxproj, 2 in build.gradle', () => {
    const stampedGradle = stampAndroid(gradle, next)
    const stampedPbxproj = stampIos(pbxproj, next)

    expect(changedLines(gradle, stampedGradle)).toBe(2)
    expect(changedLines(pbxproj, stampedPbxproj)).toBe(occurrences * 2)
    expect(parseAndroid(stampedGradle)).toEqual(next)
    expect(parseIos(stampedPbxproj)).toEqual(next)
    expect(stampedPbxproj.match(/MARKETING_VERSION = 10\.9\.14;/g)).toHaveLength(occurrences)
    expect(stampedPbxproj.match(/CURRENT_PROJECT_VERSION = 7000;/g)).toHaveLength(occurrences)
  })

  it('is idempotent', () => {
    expect(stampAndroid(stampAndroid(gradle, next), next)).toBe(stampAndroid(gradle, next))
    expect(stampIos(stampIos(pbxproj, next), next)).toBe(stampIos(pbxproj, next))
  })
})

describe('missing version patterns', () => {
  it.each([
    [
      'parseAndroid',
      () => {
        return parseAndroid('android {}')
      },
    ],
    [
      'parseIos',
      () => {
        return parseIos('{}')
      },
    ],
    [
      'stampAndroid',
      () => {
        return stampAndroid('versionCode 1', { version: '1.0.0', build: 2 })
      },
    ],
    [
      'stampIos',
      () => {
        return stampIos('MARKETING_VERSION = 1.0.0;', { version: '1.0.0', build: 2 })
      },
    ],
  ])('%s throws a usage error', (_name, call) => {
    expect(call).toThrow(CliError)
  })
})
