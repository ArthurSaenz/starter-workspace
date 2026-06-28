import type { TypedFlatConfigItem } from '@antfu/eslint-config'

import { GLOB_MD, GLOB_TS, GLOB_TS_DOC_EXCLUDE } from '../globs.js'
import type { ConfigRules } from '../types.js'
import { sonarjsRecommended } from './base.js'

/**
 * Size-gated JSDoc — positional arg 7. Any function longer than `minLineCount` lines must carry a
 * JSDoc block with a body-style description and at least one `@example`. The gate is line count, NOT
 * cyclomatic complexity (a drift-free proxy; raise `minLineCount` to cut noise). Fixers are OFF so a
 * `fix` run never injects empty doc stubs. The `jsdoc/` plugin is provided and registered by antfu;
 * flat config merges plugins per-file, so these rules resolve without re-registering it. Scoped to TS
 * sources; tests, stories, declaration and generated files are exempt.
 */
export const jsdoc: TypedFlatConfigItem = {
  files: [GLOB_TS],
  ignores: GLOB_TS_DOC_EXCLUDE,
  rules: {
    'jsdoc/require-jsdoc': [
      'error',
      {
        enableFixer: false,
        minLineCount: 15,
        require: {
          ArrowFunctionExpression: true,
          FunctionDeclaration: true,
          FunctionExpression: true,
          MethodDefinition: true,
        },
      },
    ],
    'jsdoc/require-description': ['error', { descriptionStyle: 'body' }],
    'jsdoc/require-example': ['error', { enableFixer: false }],
  } as ConfigRules,
}

// Temporary disable all sonarjs rules for markdown files — positional arg 8. Derived from the sonarjs
// recommended rule keys so it tracks the preset automatically on a sonarjs bump.
export const markdown: TypedFlatConfigItem = {
  files: [GLOB_MD],
  rules: Object.fromEntries(Object.keys(sonarjsRecommended.rules ?? {}).map((rule) => [rule, 'off'])) as ConfigRules,
}
