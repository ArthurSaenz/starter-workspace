import { describe, expect, it } from 'vitest'

import { checkWorkingTree, parseAndroid, parseIos, stampAndroid, stampIos } from '../version.ts'
import { readFixture } from './fixture-app.ts'

const GRADLE = readFixture('hulyo-build.gradle')
const PBXPROJ = readFixture('hulyo-project.pbxproj')
const HEAD = { android: parseAndroid(GRADLE), ios: parseIos(PBXPROJ) }
const COMPUTED = { android: { version: '10.9.14', build: 2000000041 }, ios: { version: '10.9.14', build: 5063 } }
const PATHS = ['android/app/build.gradle', 'ios/App/App.xcodeproj/project.pbxproj']

const check = (gradle: string, pbxproj: string) => {
  return checkWorkingTree(
    { android: { source: gradle, head: HEAD.android }, ios: { source: pbxproj, head: HEAD.ios } },
    COMPUTED,
    PATHS,
  )
}

describe('checkWorkingTree', () => {
  it('stamps a working tree equal to HEAD', () => {
    expect(check(GRADLE, PBXPROJ)).toEqual({ android: 'stamp', ios: 'stamp' })
  })

  it('writes nothing when the working tree already holds the computed stamp', () => {
    expect(check(stampAndroid(GRADLE, COMPUTED.android), stampIos(PBXPROJ, COMPUTED.ios))).toEqual({
      android: 'unchanged',
      ios: 'unchanged',
    })
  })

  it('ignores lines other than the version lines (cap sync may change them)', () => {
    const synced = `${stampIos(PBXPROJ, COMPUTED.ios)}\n// cap sync`

    expect(check(GRADLE, synced)).toEqual({ android: 'stamp', ios: 'unchanged' })
  })

  it('exits 2 on any other stamp, telling the human how to resolve it', () => {
    const foreign = stampAndroid(GRADLE, { version: '10.9.13', build: 2000000041 })

    expect(() => {
      return check(foreign, PBXPROJ)
    }).toThrow(
      expect.objectContaining({
        exitCode: 2,
        message:
          'a previous stamp (10.9.13 / iOS 10.0.0, iOS 5062 / Android 2000000041) is uncommitted: commit it if that build was uploaded, otherwise `git checkout -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj`',
      }),
    )
  })

  it('exits 2 when only one of several pbxproj occurrences was edited by hand', () => {
    const edited = PBXPROJ.replace('CURRENT_PROJECT_VERSION = 5062;', 'CURRENT_PROJECT_VERSION = 5070;')

    expect(() => {
      return check(GRADLE, edited)
    }).toThrow(
      expect.objectContaining({
        exitCode: 2,
        message: expect.stringContaining('commit it if that build was uploaded'),
      }),
    )
  })
})
