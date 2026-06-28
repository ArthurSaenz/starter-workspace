import type { TypedFlatConfigItem } from '@antfu/eslint-config'

import { GLOB_BUILTIN_IGNORES } from '../globs.js'

// Final ignores block — positional arg 9. Built-in ignores first, then any consumer-supplied globs.
export const ignores = (userIgnores: string[] = []): TypedFlatConfigItem => ({
  ignores: [...GLOB_BUILTIN_IGNORES, ...userIgnores],
})
