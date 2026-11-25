// Compares the built Storybook index (`storybook-static/index.json`) with the titles the registry
// expects: `features/catalogue/Catalogue`, one `features/ai-chat/<Area>/<Feature>` per feature that has a stories file,
// and the legacy titles until Phase 3 folds them. Exits 1 on any difference — until Phase 4.12 lands
// the last per-feature file this is the completeness reporter, and the diff is expected.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FEATURES, expectedStoryTitles } from '../dist/features/catalogue/services/main.js'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = resolve(packageDir, 'storybook-static', 'index.json')

if (!existsSync(indexPath)) {
  console.error(`${indexPath} not found — run \`pnpm run storybook-build\` first`)
  process.exit(1)
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const actual = new Set(Object.values(index.entries).map((entry) => entry.title))
const expected = expectedStoryTitles(FEATURES)

const missing = [...expected].filter((title) => !actual.has(title)).sort()
const unexpected = [...actual].filter((title) => !expected.has(title)).sort()

console.log(`storybook index: ${actual.size} titles, registry expects ${expected.size}`)

if (missing.length > 0) {
  console.log(`\nMissing from Storybook (${missing.length}):`)
  for (const title of missing) console.log(`  - ${title}`)
}

if (unexpected.length > 0) {
  console.log(`\nNot in the registry (${unexpected.length}):`)
  for (const title of unexpected) console.log(`  + ${title}`)
}

if (missing.length > 0 || unexpected.length > 0) process.exit(1)

console.log('storybook index matches the registry')
