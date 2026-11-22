import { defineNodeConfig } from '@wl/vitest-config'

export default defineNodeConfig(import.meta.dirname, {
  test: {
    // `tools.hotels.test.ts` runs a real PGlite instance and applies every lib-db migration.
    // In parallel with the other files that setup intermittently times out — the same flake
    // already pinned in lib-db and backoffice-api.
    fileParallelism: false,
    // Serial files are not enough on the CI runner: with turbo running other packages' suites
    // alongside, the PGlite migrate in `beforeAll` crossed the 10s default (QA run 36350474690).
    // `--testTimeout` from the CI step does not cover hooks. Same headroom as lib-db.
    hookTimeout: 60000,
    coverage: {
      include: ['src/**'],
      exclude: ['src/__tests__/**', 'src/index.ts'],
      // Floor under today's numbers (97 % lines / 83 % branches) so an extension that lands
      // untested fails `test-report` instead of quietly eroding the suite.
      thresholds: { lines: 90, branches: 75, functions: 90, statements: 90 },
    },
  },
})
