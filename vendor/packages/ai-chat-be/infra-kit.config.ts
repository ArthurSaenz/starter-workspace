import { defineConfig } from '@slip-stream-kit/config'

// `pnpm chat-check` runs `test-report`.
export default defineConfig(() => {
  return {
    requiredScripts: ['build', 'ts-check', 'eslint-check', 'prettier-check', 'test', 'test-report'],
  }
})
