import type { TypedFlatConfigItem } from '@antfu/eslint-config'
import wl from '@slip-stream-kit/eslint-plugin'

// White-label component-file conventions, consumed from the plugin's `configs.recommended` preset
// (the single source of truth for rule scope/rationale). Spread by the factory so each preset block
// becomes a positional antfu config. Typed as an array (it is one at runtime) so the factory can
// spread it.
export const wlComponentsRecommended: TypedFlatConfigItem[] = [
  ...(wl.configs.recommended as TypedFlatConfigItem[]),
  // ── TEMPORARILY DISABLED: component/JSX size rules ──────────────────────────
  // Appended last so it overrides the preset (flat config: later blocks win for
  // matching files). To RE-ENABLE, just delete this override block.
  {
    files: ['**/*.tsx'],
    rules: {
      '@wl/max-jsx-return-size': 'off',
      '@wl/max-components-per-file': 'off',
    },
  },
  // ────────────────────────────────────────────────────────────────────────────
]
