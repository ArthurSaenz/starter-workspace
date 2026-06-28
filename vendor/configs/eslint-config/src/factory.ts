import antfu from '@antfu/eslint-config'
import type { TypedFlatConfigItem } from '@antfu/eslint-config'

import { antfuBaseOptions, overrides, sonarjsRecommended } from './configs/base.js'
import { boundaries } from './configs/boundaries.js'
import { wlComponentsRecommended } from './configs/components.js'
import { jsdoc, markdown } from './configs/docs.js'
import { frameworks } from './configs/frameworks/index.js'
import { ignores } from './configs/ignores.js'
import { isKnownMode, resolveOptions } from './options.js'
import type { ConfigOptions } from './types.js'

// Minimal ambient declaration so the unknown-mode dev warning type-checks without pulling in DOM or
// @types/node (this package imports no node: builtins). `console` exists globally at runtime in Node.
declare const console: { warn: (...args: unknown[]) => void }

const hasKeys = (obj: object): boolean => Object.keys(obj).length > 0

/**
 * Build the shared flat ESLint config. Composes @antfu/eslint-config + sonarjs + architecture import
 * boundaries + the white-label component conventions + size-gated JSDoc into a single `antfu(...)`
 * call. Every layer is gated by an option whose default reproduces the historical config byte-for-byte,
 * so `createConfig()` and `createConfig({ ignores })` are unchanged for existing consumers.
 *
 * The modules are passed as POSITIONAL arguments in the original order; optional `rules`/`userConfigs`
 * are appended only when non-empty, so the default call shape never changes.
 *
 * @example
 * export default createConfig() // react preset, all layers on
 * export default createConfig({ mode: 'svelte', boundaries: 'error', ignores: ['dist'] })
 */
export const createConfig = async (userOptions: ConfigOptions = {}): Promise<TypedFlatConfigItem[]> => {
  const o = resolveOptions(userOptions)

  if (!isKnownMode(o.mode)) {
    console.warn(`[@wl/eslint-config] Unknown mode "${o.mode}"; falling back to "react".`)
  }

  const fw = frameworks[o.mode] ?? frameworks.react

  const baseConfig = await antfu(
    { ...antfuBaseOptions, ...fw.antfuFlags },
    sonarjsRecommended,
    overrides,
    ...(o.boundaries === false ? [] : [boundaries(o.boundaries)]),
    ...fw.extraConfigs,
    ...(o.components ? wlComponentsRecommended : []),
    ...(o.jsdoc ? [jsdoc] : []),
    ...(o.markdown ? [markdown] : []),
    ignores(o.ignores),
    ...(hasKeys(o.rules) ? [{ rules: o.rules }] : []),
    ...o.userConfigs,
  )

  return baseConfig
}

export default createConfig
