import tailwindcss from '@tailwindcss/vite'

import { defineReactBrowserConfig } from '@wl/vitest-config'

export default defineReactBrowserConfig(import.meta.dirname, {
  // The preview's tailwind.css is a real `@import 'tailwindcss'` entry; without the plugin no
  // utility is generated under the runner and every story renders unstyled.
  plugins: [tailwindcss()],
  // The stories' Docs text (`featureDocs`) reads `CopilotChatDefaultLabels` from the headless entry,
  // which Vite's pre-scan misses; on a cold cache it was optimized mid-run and the tester reloaded
  // ("Vitest failed to find the current suite", stories.test.tsx collected 0 tests).
  optimizeDeps: { include: ['@copilotkit/react-core/v2', '@copilotkit/react-core/v2/headless'] },
  test: {
    // Every story and state test fakes the runtime by replacing the one `window.fetch`; keep the
    // files serial so one file's restore can never land on another file's install.
    fileParallelism: false,
    coverage: {
      include: ['src/**'],
      exclude: ['src/**/__tests__/**', '**/*.stories.tsx', 'src/**/index.ts', 'src/typings/**'],
      thresholds: { lines: 90, branches: 75, functions: 90, statements: 90 },
    },
  },
})
