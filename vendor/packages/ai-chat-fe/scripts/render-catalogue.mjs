// Rewrites the README block between the catalogue markers from the built registry. Imports
// `services/main.js` (CopilotKit-free) and never the feature barrel: react-core's `.css` import is
// not loadable under node. `pnpm run catalogue` builds first.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FEATURES, renderCatalogueMarkdown } from '../dist/features/catalogue/services/main.js'

const START = '<!-- catalogue:start -->'
const END = '<!-- catalogue:end -->'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readmePath = resolve(packageDir, 'readme.md')
const readme = readFileSync(readmePath, 'utf8')
const start = readme.indexOf(START)
const end = readme.indexOf(END)

if (start === -1 || end === -1 || end < start) {
  console.error(`readme.md needs both ${START} and ${END}, in that order`)
  process.exit(1)
}

const block = `${START}\n\n${renderCatalogueMarkdown(FEATURES)}\n\n${END}`

writeFileSync(readmePath, `${readme.slice(0, start)}${block}${readme.slice(end + END.length)}`)

// The `prettier-check` gate covers readme.md and re-aligns table columns; formatting here keeps the
// generated block byte-identical to what the gate expects.
execFileSync(
  'pnpm',
  ['exec', 'prettier', '--write', 'readme.md', '--log-level', 'silent', '--ignore-path', '../../../.prettierignore'],
  { cwd: packageDir, stdio: 'inherit' },
)

console.log(`readme.md: catalogue block rendered (${FEATURES.length} features)`)
