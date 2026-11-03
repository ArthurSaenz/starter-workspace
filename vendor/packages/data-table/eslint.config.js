import config from '@wl/eslint-config'

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
  ],
})
