import { defineReactBrowserConfig } from '@wl/vitest-config'

export default defineReactBrowserConfig(import.meta.dirname, {
  // Vite's default deny list also blocks `**/.git/**`, and merge-dev verifies in a checkout under
  // .git/infra-kit/ — every browser-mode module request would be refused there.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}'] } },
  test: {
    // `.test-d.ts` files assert on types only; Vitest typechecks them with tsc alongside the
    // browser-mode suites instead of executing them.
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
  },
})
