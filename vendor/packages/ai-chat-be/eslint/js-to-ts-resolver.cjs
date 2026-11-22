/**
 * `eslint-module-utils` resolver (interfaceVersion 2) for NodeNext source: `./x.js` → `./x.ts`.
 *
 * tsc-built packages must write relative imports with a `.js` extension that does not exist on
 * disk until build. The node resolver in the vendored `@wl/eslint-config` therefore returns
 * `found: false`, and `eslint-plugin-boundaries` silently skips any import it cannot resolve —
 * so `boundaries/dependencies` checked nothing in these packages. This mirrors TypeScript's own
 * NodeNext substitution so the rule sees the real target.
 *
 * Belongs upstream next to `vendor/configs/eslint-config/resolvers/root-alias.cjs`; kept in the
 * package until then so it lints the same in every repo it is vendored into.
 *
 * CommonJS because `eslint-module-utils` loads resolvers with a synchronous `require()`.
 */

const fs = require('node:fs')
const path = require('node:path')

const JS_TO_TS = [
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]

const isFile = (candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() === true

/**
 * @param {string} source the import specifier
 * @param {string} file absolute path of the importing file
 */
function resolve(source, file) {
  if (typeof source !== 'string' || !source.startsWith('.')) return { found: false }

  const mapping = JS_TO_TS.find(([jsExtension]) => source.endsWith(jsExtension))
  if (!mapping) return { found: false }

  const [jsExtension, tsExtensions] = mapping
  const base = path.resolve(path.dirname(file), source.slice(0, -jsExtension.length))

  for (const tsExtension of tsExtensions) {
    if (isFile(`${base}${tsExtension}`)) return { found: true, path: `${base}${tsExtension}` }
  }

  return { found: false }
}

module.exports = { interfaceVersion: 2, resolve }
