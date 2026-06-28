import type { TypedFlatConfigItem } from '@antfu/eslint-config'
import boundariesPlugin from 'eslint-plugin-boundaries'

import { GLOB_SRC_ALL } from '../globs.js'
import type { ConfigRules } from '../types.js'

/**
 * Phase 2 — relationship-aware import boundaries (eslint-plugin-boundaries).
 *
 * Where Phase 1's `no-restricted-imports` (in base.ts overrides) is string-only, this layer resolves
 * each import, classifies both ends as an architectural element (feature / service / shared) and
 * enforces RELATIONSHIPS via the single modern `boundaries/dependencies` rule (v6 deprecates
 * `entry-point`/`element-types`):
 *   - sibling cross-imports are TYPE-ONLY: feature<->feature / service<->service /
 *     feature<->service may reference each other only via `import type` (no runtime coupling).
 *   - shared is the one runtime exception: features/services may import `shared` at value level
 *     through its barrel. `shared` itself may not depend outward (not even types).
 *   - same-element imports are exempt (checkInternals=false).
 *
 * Severity is parameterized (default 'warn'): dormant on packages without a features/services tree
 * (their files are `unknown`); promote to 'error' after a clean baseline.
 *
 * @example
 * boundaries('warn') // historical default
 * boundaries('error') // stricter; only the rule severity changes
 */
export const boundaries = (severity: 'warn' | 'error' = 'warn'): TypedFlatConfigItem => ({
  files: [GLOB_SRC_ALL],
  plugins: { boundaries: boundariesPlugin },
  settings: {
    // Resolve TS sources via the node resolver (bundled with the plugin) — no native deps. Real
    // consumers using path aliases (e.g. `#root` => src) should add their own resolver (e.g.
    // eslint-import-resolver-typescript) so boundaries can classify them.
    'import/resolver': {
      node: { extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'] },
    },
    'boundaries/elements': [
      { type: 'shared', pattern: '**/shared', mode: 'folder' },
      // Feature-nested services must be matched before the generic feature pattern.
      {
        type: 'service',
        pattern: '**/features/*/services/*',
        mode: 'folder',
        capture: ['feature', 'service'],
      },
      { type: 'feature', pattern: '**/features/*', mode: 'folder', capture: ['feature'] },
      { type: 'service', pattern: '**/services/*', mode: 'folder', capture: ['service'] },
    ],
  },
  rules: {
    // Single modern rule (v6; `entry-point`/`element-types` are deprecated). Policy:
    // cross-element imports between SIBLINGS (feature<->feature, service<->service,
    // feature<->service) must be TYPE-ONLY — no runtime/value cross-import. The one
    // runtime exception is the shared layer: features/services may import `shared` at
    // value level through its barrel. `shared` may not depend outward at all (no rule),
    // so shared -> feature/service is disallowed for both value AND type. Intra-element
    // imports are exempt (checkInternals=false).
    'boundaries/dependencies': [
      severity,
      {
        default: 'disallow',
        rules: [
          // VALUE exception: features/services may use the shared layer at runtime,
          // through its barrel only (deep value imports into shared stay disallowed).
          {
            from: { type: ['feature', 'service'] },
            allow: { to: { type: 'shared', internalPath: 'index.{ts,tsx,js,jsx}' } },
          },
          // TYPE-ONLY cross-element imports (any path) are allowed for features/services —
          // this is the only way siblings may reference each other. Types are erased at
          // runtime, so they create no runtime coupling. `from: shared` is intentionally
          // absent: shared must not depend on features/services even for types.
          {
            from: { type: ['feature', 'service'] },
            dependency: { kind: 'type' },
            allow: { to: { type: ['feature', 'service', 'shared'] } },
          },
        ],
      },
    ],
  } as ConfigRules,
})
