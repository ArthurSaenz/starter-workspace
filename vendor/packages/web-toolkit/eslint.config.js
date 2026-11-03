import config from '@wl/eslint-config'

export default config({
  // A library has no HMR boundary of its own, so modules may export helpers next to components.
  rules: { 'react-refresh/only-export-components': 'off' },
})
