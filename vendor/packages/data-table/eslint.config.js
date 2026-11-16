import config from '@wl/eslint-config'

/**
 * A module under src/ is imported through its index only, so its files can move without edits
 * elsewhere. `depth` is how many folders below src/ the importing file sits.
 */
const barrelOnly = (files, depth) => {
  const up = depth === 0 ? String.raw`\./` : String.raw`\.\./`.repeat(depth)

  return {
    files,
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^${up}[^./][^/]*/`,
              message: "Import another module of this package through its index (e.g. '../primitives').",
            },
          ],
        },
      ],
    },
  }
}

export default config({
  // Primitives are shadcn copies; their Tailwind arbitrary values are pixel-perfect.
  shadcn: false,
  // A library has no HMR boundary of its own, so modules may export helpers next to components.
  rules: { 'react-refresh/only-export-components': 'off' },
  userConfigs: [
    {
      // shadcn primitives keep their upstream one-file-per-primitive-family layout.
      files: ['src/primitives/**'],
      rules: { '@wl/max-components-per-file': 'off' },
    },
    barrelOnly(['src/*.{ts,tsx}'], 0),
    barrelOnly(['src/*/*.{ts,tsx}'], 1),
    barrelOnly(['src/*/*/*.{ts,tsx}'], 2),
    barrelOnly(['src/*/*/*/*.{ts,tsx}'], 3),
  ],
})
