import type { OptionsConfig, TypedFlatConfigItem } from '@antfu/eslint-config'

import { svelteConfig } from './svelte.js'

/** A framework preset: antfu option flags + any extra positional configs to splice into the call. */
export interface FrameworkPreset {
  /** Flags merged onto the base antfu options (e.g. `{ react: true }`). Typed against antfu's own
   *  options so a misspelled flag (`{ reactt: true }`) is a compile error, not a silent no-op. */
  antfuFlags: Partial<OptionsConfig>
  /** Extra flat-configs spliced in at the framework position (after boundaries, before components). */
  extraConfigs: TypedFlatConfigItem[]
}

/**
 * Framework registry — the single seam for adding a new mode. To add a framework, drop a
 * `configs/frameworks/<name>.ts` exporting its config(s) and add one entry here. The factory looks
 * the preset up by `mode` and falls back to `react` for unknown values.
 */
export const frameworks: Record<string, FrameworkPreset> = {
  react: { antfuFlags: { react: true }, extraConfigs: [] },
  svelte: { antfuFlags: { svelte: true }, extraConfigs: [svelteConfig] },
}
