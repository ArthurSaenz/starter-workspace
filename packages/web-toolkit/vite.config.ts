import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// eslint-disable-next-line ts/ban-ts-comment
// @ts-ignore
import { peerDependencies } from './package.json'

export default defineConfig(
  () =>
    { return {
      build: {
        target: 'esnext',
        lib: {
          entry: ['src/index.ts'],
          formats: ['es'],
          fileName: (format) => { return `index.${format}.js` },
          cssFileName: 'style',
        },
        rolldownOptions: {
          external: [...Object.keys(peerDependencies)],
        },
        sourcemap: true,
      },
      plugins: [react(), dts({ insertTypesEntry: true })],
    } },
)
