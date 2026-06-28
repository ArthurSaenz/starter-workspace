import type { TypedFlatConfigItem } from '@antfu/eslint-config'
import sonarjs from 'eslint-plugin-sonarjs'

import type { ConfigRules } from '../types.js'

/** Base antfu options shared by every mode. Framework flags (react/svelte) are merged in the factory. */
export const antfuBaseOptions = { lessOpinionated: true }

/** sonarjs recommended preset — positional arg 2 of the antfu call. */
export const sonarjsRecommended = sonarjs.configs.recommended

/**
 * The project-wide rule overrides — positional arg 3.
 *
 * Extracted VERBATIM from the original index.js: rule order, the `no-restricted-imports` Phase-1
 * region, the prettier-coordination toggles, and the intentional duplicate keys are all preserved.
 * Do not reorder or dedupe — the zero-drift baseline depends on byte-for-byte equivalence.
 */
export const overrides: TypedFlatConfigItem = {
  rules: {
    'antfu/top-level-function': 'off',
    'antfu/consistent-chaining': 'off',

    'react/prefer-shorthand-boolean': 'off',

    // TEMPORARY DISABLED RULES
    'react/component-hook-factories': 'off',
    'react/rules-of-hooks': 'off',
    'react/unsupported-syntax': 'off',

    'react-refresh/only-export-components': 'off',

    'perfectionist/sort-imports': 'off',
    'style/arrow-parens': ['error', 'always'],
    'arrow-body-style': ['error', 'always'],

    // Temporary disable
    'ts/no-use-before-define': 'off',

    'perfectionist/sort-named-imports': 'off',

    'e18e/prefer-static-regex': 'off',
    'e18e/prefer-array-from-map': 'off',

    'style/padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: '*', next: 'return' },
      { blankLine: 'always', prev: ['const', 'let'], next: '*' },
      { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
    ],
    'style/jsx-one-expression-per-line': 'off',
    'style/brace-style': 'off',
    'style/member-delimiter-style': 'off',
    'style/multiline-ternary': 'off',
    'style/operator-linebreak': 'off', // TODO
    'style/quote-props': 'off',
    'style/jsx-wrap-multilines': 'off',
    'style/indent-binary-ops': 'off',
    'style/indent': 'off',
    // NOTE: in the original index.js, 'style/jsx-wrap-multilines' and 'style/indent-binary-ops' were
    // each listed twice with the identical value ('off'). TypeScript (TS1117) forbids duplicate object
    // keys, so the redundant second copies are dropped here. This is print-config-neutral: same value,
    // last-wins === single declaration, so the effective rule set is unchanged.
    'style/jsx-curly-newline': 'off',
    'style/quotes': 'off',

    curly: 'off',

    'sonarjs/fixme-tag': 'warn',
    'sonarjs/todo-tag': 'warn',
    'sonarjs/mouse-events-a11y': 'off',
    'sonarjs/no-array-index-key': 'off',

    'sonarjs/no-commented-code': 'off', // TODO: temporary disable, must be enabled

    'unicorn/no-new-array': 'off',

    // prettier owns numeric-literal formatting (lowercases hex), which conflicts with
    // unicorn/number-literal-case (wants uppercase hex digits). Let prettier win.
    'unicorn/number-literal-case': 'off',

    //#region Architecture import relation rules
    // Enforce public-API boundaries: features/services must be imported via their barrel
    // (index.ts), never their internals. `**/<kind>/*/**` anchors on the segment (not a
    // leading-segment count), so it matches every prefix (#root/, @/, src/, ../) at any
    // depth, while the trailing `/**` requires >=1 inner segment — keeping the bare-directory
    // barrel import allowed.
    //
    // The two `!`-negations carve the IMMEDIATE `index` barrel back out: an EXPLICIT barrel
    // import (`.../<el>/index`, `.../<el>/index.js|ts|…`) is the public API and must pass —
    // it is also the ONLY valid form under NodeNext/ESM, where a bare-directory import does
    // not resolve. ESLint matches these globs with gitignore semantics, so `!` re-includes;
    // `*` never crosses `/`, so a nested `.../internal/index.js` stays blocked. Keep the
    // features/services carve-outs identical — the paired barrel tests guard each side's
    // behavior. Known residual: a feature-nested-service barrel
    // (`features/*/services/*/index.js`) cannot be re-included this way (gitignore forbids
    // re-including under an excluded parent dir) — deferred to Phase 2.
    //
    // String-only: bans deep imports but can't detect cross-element relationships (feature A
    // -> feature B); that is gated Phase 2, see .omc/plans/eslint-import-boundary-rules.md.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/features/*/**', '!**/features/*/index', '!**/features/*/index.*'],
            message:
              "Importing private modules from a feature is prohibited. Use the feature's public API (index.ts) instead.",
          },
          {
            group: ['**/services/*/**', '!**/services/*/index', '!**/services/*/index.*'],
            message:
              "Importing private modules from a service is prohibited. Use the service's public API (index.ts) instead.",
          },
        ],
      },
    ],
    //#endregion Architecture import relation rules
  } as ConfigRules,
}
