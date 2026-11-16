/**
 * Lays `overrides` over `defaults`, skipping entries that are `undefined`: `Partial` lets a caller
 * pass `{ kind: undefined }` (a conditional override), and a plain spread would erase the built-in.
 */
export const mergeOverrides = <TRegistry extends object>(
  defaults: TRegistry,
  overrides: Partial<TRegistry> | undefined,
): TRegistry => {
  const merged = { ...defaults }

  for (const key of Object.keys(overrides ?? {}) as (keyof TRegistry)[]) {
    const override = overrides?.[key]

    if (override !== undefined) {
      merged[key] = override
    }
  }

  return merged
}
