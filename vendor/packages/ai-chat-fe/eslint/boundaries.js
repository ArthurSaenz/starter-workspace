/**
 * The vendored `boundaries/dependencies` policies (`vendor/configs/eslint-config/src/configs/boundaries.ts`),
 * restated because rule options replace rather than merge: a block that adds a policy must repeat the
 * base ones. A consumer can deep-equal this copy against the vendored build to catch drift.
 */
export const VENDORED_POLICIES = [
  {
    from: { element: { type: ['feature', 'service'] } },
    allow: { to: { element: { type: 'shared', fileInternalPath: 'index.{ts,tsx,js,jsx}' } } },
  },
  {
    from: { element: { type: ['feature', 'service'] } },
    dependency: { kind: 'type' },
    allow: { to: { element: { type: ['feature', 'service', 'shared'] } } },
  },
]
