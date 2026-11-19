import { defineConfig } from '@slip-stream-kit/config'

export default defineConfig(() => {
  return {
    requiredScripts: ['ts-check', 'eslint-check', 'prettier-check', 'test'],
  }
})
