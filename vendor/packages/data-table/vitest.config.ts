import tailwindcss from '@tailwindcss/vite'

import { defineReactBrowserConfig } from '@wl/vitest-config'

export default defineReactBrowserConfig(import.meta.dirname, {
  // Only the screenshot suite imports CSS; see src/__tests__/visual-theme.css. Cast for the same
  // Vite-version Plugin type mismatch @wl/vitest-config works around for the React plugin.
  plugins: [tailwindcss() as never],
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
