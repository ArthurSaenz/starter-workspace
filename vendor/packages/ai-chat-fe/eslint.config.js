import config from '@wl/eslint-config'

import { VENDORED_POLICIES } from './eslint/boundaries.js'
import { nodeEsmResolution } from './eslint/node-esm.js'

export default config({
  userConfigs: [
    nodeEsmResolution,
    {
      files: ['src/**'],
      rules: {
        // This override replaces the base @wl/eslint-config rule wholesale, so the base barrel-only
        // patterns are repeated here. `boundaries/dependencies` guards feature barrels too, but only
        // between elements; these patterns also cover imports from non-element folders.
        'no-restricted-imports': [
          'error',
          {
            // Stories and tests live next to the source; a self-import would run the stale dist build.
            paths: [
              {
                name: '@wl/ai-chat-fe',
                message: 'import from a relative path — the package import resolves to dist',
              },
            ],
            patterns: [
              {
                group: ['**/features/*/**', '!**/features/*/index', '!**/features/*/index.*'],
                message:
                  "Importing private modules from a feature is prohibited. Use the feature's public API (index.ts) instead.",
              },
              {
                group: ['**/services/*/**', '!**/services/*/index', '!**/services/*/index.*'],
                message:
                  "Importing private modules from a service is prohibited. Use the service's public API (index.ts) instead.",
              },
              {
                group: ['@wl/ai-chat-fe/*'],
                message: 'import from a relative path — the package import resolves to dist',
              },
            ],
          },
        ],
      },
    },
    {
      // The `ai-chat` stories and tests render the `catalogue` feature card as their docs header.
      // That edge exists only in non-shipped files, so it is allowed there, barrel only, rather than
      // in the runtime policy. Rule options replace rather than merge, hence the restated base.
      name: 'ai-chat-fe/story-test-boundaries',
      files: ['src/features/*/__stories__/**', 'src/features/*/__tests__/**'],
      rules: {
        'boundaries/dependencies': [
          'error',
          {
            default: 'disallow',
            policies: [
              ...VENDORED_POLICIES,
              {
                from: { element: { type: 'feature' } },
                allow: { to: { element: { type: 'feature', fileInternalPath: 'index.{ts,tsx,js,jsx}' } } },
              },
            ],
          },
        ],
      },
    },
  ],
})
