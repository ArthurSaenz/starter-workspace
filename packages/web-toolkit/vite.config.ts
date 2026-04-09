import react from '@vitejs/plugin-react-swc'
import type { UserConfig } from 'vite'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// eslint-disable-next-line ts/ban-ts-comment
// @ts-ignore
import { peerDependencies } from './package.json'

export default defineConfig(
  () =>
    ({
      css: {
        preprocessorOptions: {
          scss: {
            api: 'modern-compiler',
          },
        },
      },
      build: {
        target: 'es2017',
        lib: {
          entry: ['src/index.ts'],
          formats: ['es'],
          fileName: (format) => `index.${format}.js`,
          cssFileName: 'style',
        },
        rollupOptions: {
          external: [...Object.keys(peerDependencies)],
        },
        sourcemap: true,
      },
      plugins: [react(), dts({ insertTypesEntry: true })],
    }) as UserConfig,
)
