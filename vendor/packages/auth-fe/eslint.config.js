import config from '@wl/eslint-config'

export default config({
  userConfigs: [
    {
      files: ['src/**'],
      rules: {
        // Replaces the base @wl/eslint-config rule wholesale to add the self-import ban, so the base
        // barrel-only patterns are repeated here.
        'no-restricted-imports': [
          'error',
          {
            // Tests live next to the source; a self-import would run the stale dist build.
            paths: [
              {
                name: '@wl/auth-fe',
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
                group: ['\\#root/lib/*/**', '!\\#root/lib/*/index', '!\\#root/lib/*/index.*'],
                message:
                  "Importing private modules from a lib module is prohibited. Use the module's public API (index.ts) instead.",
              },
              {
                group: ['@wl/auth-fe/*'],
                message: 'import from a relative path — the package import resolves to dist',
              },
            ],
          },
        ],
      },
    },
  ],
})
