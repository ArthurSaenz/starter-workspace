import { defineConfig } from '@slip-stream-kit/config'

// `pnpm chat-check` runs `test-report`; `storybook-check` guards the feature catalogue's stories.
export default defineConfig(() => {
  return {
    requiredScripts: ['build', 'ts-check', 'eslint-check', 'prettier-check', 'test', 'test-report', 'storybook-check'],
  }
})
