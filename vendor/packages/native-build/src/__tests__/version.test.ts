import { describe, expect, it } from 'vitest'

import { CliError } from '../cli-error.ts'
import { nextVersion, parseAndroid, parseIos, stampAndroid, stampIos } from '../version.ts'
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

describe('commented-out and look-alike version lines', () => {
  const gradle = readFixture('hulyo-build.gradle').replace(
    '        versionCode 2000000040',
    '        // versionCode 1999999999\n        // versionName "9.9.9"\n        versionCode 2000000040',
  )

  const pbxproj = readFixture('hulyo-project.pbxproj').replace(
    '\t\t\t\tMARKETING_VERSION = 10.0.0;',
    '\t\t\t\tOTHER_MARKETING_VERSION = 1.2.3;\n\t\t\t\tMARKETING_VERSION = 10.0.0;',
  )

  const next = { version: '10.9.14', build: 7000 }

  it('neither parses nor stamps a commented-out gradle line above the real one', () => {
    const stamped = stampAndroid(gradle, next)

    expect(parseAndroid(gradle)).toEqual({ version: '10.0.0', build: 2000000040 })
    expect(stamped).toContain(
      '        // versionCode 1999999999\n        // versionName "9.9.9"\n        versionCode 7000',
    )
    expect(stamped).toContain('        versionName "10.9.14"')
  })

  it('leaves a pbxproj key that merely ends in MARKETING_VERSION alone', () => {
    const stamped = stampIos(pbxproj, next)

    expect(parseIos(pbxproj)).toEqual({ version: '10.0.0', build: 5062 })
    expect(stamped).toContain('OTHER_MARKETING_VERSION = 1.2.3;')
    expect(stamped.match(/^\t+MARKETING_VERSION = 10\.9\.14;$/gm)).toHaveLength(4)
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

const stamps = (version: string, ios: number, android: number, androidVersion = version) => {
  return { ios: { version, build: ios }, android: { version: androidVersion, build: android } }
}

const entry = (source: string, version: string, ios: number, android: number) => {
  return { source, ...stamps(version, ios, android) }
}

describe('nextVersion', () => {
  const head = stamps('10.0.0', 5062, 2000000040)

  const devHistory = ['10.9.9', '10.9.10', '10.9.11', '10.9.12', '10.9.13'].map((version, index) => {
    return entry(`dev (${index})`, version, 5055 + index, 2000000033 + index)
  })

  it('hEAD 10.0.0 with 10.9.9..10.9.13 in history: dev → 10.9.14, prod → 10.0.0', () => {
    expect(nextVersion('dev', head, devHistory).version).toBe('10.9.14')
    expect(nextVersion('prod', head, devHistory).version).toBe('10.0.0')
  })

  it('hEAD 10.0.0 without any 10.9.x: dev → 10.9.9', () => {
    expect(nextVersion('dev', head, [entry('main', '9.9.20', 5000, 2000000001)]).version).toBe('10.9.9')
  })

  it('hEAD 10.9.13: dev → 10.9.14, prod → 10.0.0', () => {
    const devHead = stamps('10.9.13', 5061, 2000000039)

    expect(nextVersion('dev', devHead, []).version).toBe('10.9.14')
    expect(nextVersion('prod', devHead, []).version).toBe('10.0.0')
  })

  it('exits 2 when the Android and iOS majors differ', () => {
    expect(() => {
      return nextVersion('dev', stamps('10.0.0', 1, 1, '9.0.0'), [])
    }).toThrow(expect.objectContaining({ exitCode: 2, message: expect.stringContaining('majors disagree') }))
  })

  it('derives normally when only the minor differs (hulyo d60ba1681: iOS 8.9.9, Android 8.0.0)', () => {
    expect(nextVersion('dev', stamps('8.9.9', 5020, 2000000026, '8.0.0'), []).version).toBe('8.9.10')
  })

  it('stamps --version as given', () => {
    expect(nextVersion('prod', head, devHistory, '11.0.0').version).toBe('11.0.0')
    expect(nextVersion('dev', head, devHistory, '10.9.99').version).toBe('10.9.99')
  })

  it('exits 2 on a --version major below HEAD', () => {
    expect(() => {
      return nextVersion('prod', head, [], '9.9.9')
    }).toThrow(expect.objectContaining({ exitCode: 2, message: expect.stringContaining('below HEAD') }))
  })

  it('takes each build number from its own platform max, naming the source', () => {
    const history = [
      entry('origin/release/a (aaa)', '10.9.13', 5070, 2000000035),
      entry('dev (bbb)', '10.9.13', 5061, 2000000050),
    ]

    expect(nextVersion('dev', head, history)).toEqual({
      major: 10,
      version: '10.9.14',
      ios: { build: 5071, source: 'origin/release/a (aaa)' },
      android: { build: 2000000051, source: 'dev (bbb)' },
    })
  })

  it('reports HEAD on a tie', () => {
    expect(nextVersion('dev', head, [entry('dev (ccc)', '10.0.0', 5062, 2000000040)]).ios.source).toBe('HEAD')
  })

  it('keeps the travelist lockstep: 5038/50038 → 5039/50039', () => {
    const travelistHead = stamps('10.0.0', 5038, 50038)
    const next = nextVersion('prod', travelistHead, [entry('release (ddd)', '10.0.0', 5038, 50038)])

    expect([next.ios.build, next.android.build]).toEqual([5039, 50039])
  })

  it('skips history entries without stamps', () => {
    expect(
      nextVersion('dev', head, [{ source: 'feature/no-native (eee)', android: undefined, ios: undefined }]).ios.build,
    ).toBe(5063)
  })
})
