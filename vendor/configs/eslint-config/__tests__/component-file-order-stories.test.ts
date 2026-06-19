import { ESLint } from 'eslint'
import path from 'node:path'
import { beforeAll, expect, it } from 'vitest'

import config from '../index.js'

// cwd = package root, mirroring the _lint-fixtures.ts idiom (this file lives in __tests__/).
const cwd = path.resolve(import.meta.dirname, '..')
const RULE = '@wl/component-file-order'

// filename -> count of RULE messages. Other rules (e.g. props-destructuring-newline, which stays
// ON for stories) are filtered out by ruleId, so they cannot affect these counts.
let byFile: Map<string, number>

beforeAll(async () => {
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: await config() })
  const results = await eslint.lintFiles(['__tests__/fixtures-stories/*.tsx'])

  byFile = new Map(results.map((r) => [path.basename(r.filePath), r.messages.filter((m) => m.ruleId === RULE).length]))
})

it('skips component-file-order on *.stories.tsx (rule disabled for stories)', () => {
  expect(byFile.get('Bad.stories.tsx')).toBe(0)
})

it('still enforces component-file-order on a non-story .tsx with identical content (control)', () => {
  expect(byFile.get('Bad.tsx')).toBeGreaterThanOrEqual(1)
})
