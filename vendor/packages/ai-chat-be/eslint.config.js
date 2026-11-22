import config from '@wl/eslint-config'

import { engineBoundaries } from './eslint/engine-boundaries.js'
import { nodeEsmResolution } from './eslint/node-esm.js'

export default config({ userConfigs: [nodeEsmResolution, ...engineBoundaries] })
