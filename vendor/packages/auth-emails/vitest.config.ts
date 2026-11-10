import { defineNodeConfig } from '@wl/vitest-config'

export default defineNodeConfig(import.meta.dirname, {
  test: {
    coverage: {
      include: ['src/**'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
})
