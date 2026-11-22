import { fileURLToPath } from 'node:url'

/**
 * Flat-config item for tsc/NodeNext packages (`./x.js` specifiers): pass it via
 * `config({ userConfigs: [nodeEsmResolution] })`. ESLint deep-merges `settings`, so this resolver
 * is appended after the vendored `#root` + node resolvers and only sees what they could not find.
 *
 * Keyed by absolute path for the same reason as the vendored `root-alias.cjs`:
 * `eslint-module-utils` loads resolvers with `require(name)` relative to the linted file.
 */
export const nodeEsmResolution = {
  name: 'ai-chat-fe/node-esm-resolution',
  settings: {
    'import/resolver': {
      [fileURLToPath(new URL('./js-to-ts-resolver.cjs', import.meta.url))]: {},
    },
  },
}
