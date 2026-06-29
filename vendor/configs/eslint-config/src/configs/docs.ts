import type { TypedFlatConfigItem } from '@antfu/eslint-config'

import { GLOB_MD, GLOB_TS, GLOB_TS_DOC_EXCLUDE } from '../globs.js'
import type { ConfigRules } from '../types.js'
import { sonarjsRecommended } from './base.js'

/**
 * React components (PascalCase functions) are exempt from `require-description` and `require-example`:
 * a component's contract is its props + JSX, not prose or a runnable example. These esquery selectors
 * REPLACE the two rules' default contexts (`ArrowFunctionExpression`, `FunctionDeclaration`,
 * `FunctionExpression`), so all three forms are re-listed, each negating the PascalCase case. The
 * heuristic is named-declaration-only: anonymous / default-export components and HOC-wrapped ones
 * (`memo(() => …)`, `forwardRef(...)`) are NOT recognized and remain subject to the rules (0 such
 * occurrences today). `require-jsdoc` is intentionally NOT given these contexts — a >15-line component
 * still owes a block (which may be empty).
 */
const NON_COMPONENT_FN_CONTEXTS = [
  'FunctionDeclaration:not([id.name=/^[A-Z]/])',
  'ArrowFunctionExpression:not(VariableDeclarator[id.name=/^[A-Z]/] > ArrowFunctionExpression)',
  'FunctionExpression:not(VariableDeclarator[id.name=/^[A-Z]/] > FunctionExpression)',
]

/**
 * Size-gated JSDoc layer. Any function longer than `minLineCount` lines must carry a
 * JSDoc block; non-component functions additionally need a body-style description and at least one
 * `@example` (PascalCase components are exempt from those two — see `NON_COMPONENT_FN_CONTEXTS`). The
 * gate is line count, NOT cyclomatic complexity (a drift-free proxy; raise `minLineCount` to cut
 * noise). Fixers are OFF so a `fix` run never injects empty doc stubs. The `jsdoc/` plugin is provided
 * and registered by antfu; flat config merges plugins per-file, so these rules resolve without
 * re-registering it. Scoped to TS sources; tests, stories, declaration and generated files are exempt.
 *
 * Invariant: `require-description` and `require-example` carry NO `minLineCount` by design — they take
 * the non-`iterateAllJsdocs` path and early-return on undocumented nodes, so they only inspect blocks
 * `require-jsdoc` already forced. The 15-line gate is thus inherited transitively; do NOT "fix" this by
 * adding `minLineCount`. `contexts` REPLACES the rule defaults, so keep all three forms listed or a
 * form silently stops being checked.
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
    'jsdoc/require-description': ['error', { descriptionStyle: 'body', contexts: NON_COMPONENT_FN_CONTEXTS }],
    'jsdoc/require-example': ['error', { enableFixer: false, contexts: NON_COMPONENT_FN_CONTEXTS }],
  } as ConfigRules,
}

// Temporary disable all sonarjs rules for markdown files. Derived from the sonarjs
// recommended rule keys so it tracks the preset automatically on a sonarjs bump.
export const markdown: TypedFlatConfigItem = {
  files: [GLOB_MD],
  rules: Object.fromEntries(Object.keys(sonarjsRecommended.rules ?? {}).map((rule) => [rule, 'off'])) as ConfigRules,
}
