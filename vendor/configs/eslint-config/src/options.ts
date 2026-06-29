import { frameworks } from './configs/frameworks/index.js'
import type { ConfigOptions, ResolvedOptions } from './types.js'

/**
 * A mode is "known" iff it has a real preset in the framework registry — the single source of truth.
 * Adding an entry to `frameworks` is therefore the ONLY edit needed to register a mode; everything
 * else (preset lookup, this validation) derives from it.
 */
export const isKnownMode = (mode: string): boolean => {
  return mode in frameworks
}

/**
 * Normalize user options into a fully-resolved shape. The defaults are an ironclad invariant: they
 * reproduce the historical config byte-for-byte — react mode, no extra ignores, boundaries at 'warn',
 * every optional layer enabled, and empty rules/userConfigs (so the factory adds no trailing args to
 * the antfu call). Changing a default here changes the zero-drift baseline.
 *
 * @example
 * resolveOptions({}) // { mode: 'react', boundaries: 'warn', jsdoc: true, markdown: true, ... }
 * resolveOptions({ boundaries: false }) // boundaries layer dropped, everything else default
 */
export const resolveOptions = (userOptions: ConfigOptions = {}): ResolvedOptions => {
  const { mode, ignores, boundaries, jsdoc, markdown, components, rules, userConfigs } = userOptions

  return {
    mode: mode ?? 'react',
    ignores: ignores ?? [],
    boundaries: boundaries === undefined ? 'warn' : boundaries === true ? 'warn' : boundaries,
    jsdoc: jsdoc ?? true,
    markdown: markdown ?? true,
    components: components ?? true,
    rules: rules ?? {},
    userConfigs: userConfigs ?? [],
  }
}
