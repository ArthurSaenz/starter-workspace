/**
 * `boundaries/dependencies` policy for the chat engine (this package).
 *
 * The engine has no `shared/`, `features/` or `services/` folder, so under the vendored policy
 * (`vendor/configs/eslint-config/src/configs/boundaries.ts`) none of its files was an element and
 * nothing was checked. Its folders already form a DAG — facades → lambda → copilotkit → langgraph,
 * tools; lambda → transcription — and this file makes that DAG the rule. `src/ports.ts` (what a host
 * supplies, e.g. the logger) sits under every layer: each of them logs, and the two leaves
 * (langgraph, transcription) cannot share any other layer, so without a leaf below them the port
 * would be an unchecked file free to import anything. Rule options and
 * `boundaries/elements` replace rather than merge, so the vendored blocks are restated unchanged
 * (a consumer can deep-equal them against the vendored build).
 */

export const VENDORED_ELEMENTS = [
  { type: 'shared', pattern: '**/shared' },
  { type: 'service', pattern: '**/features/*/services/!(__*__)', capture: ['base', 'feature', 'service'] },
  { type: 'feature', pattern: '**/features/*', capture: ['base', 'feature'] },
  { type: 'service', pattern: '**/services/!(__*__)', capture: ['base', 'service'] },
]

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

const LAYERS = ['lambda', 'copilotkit', 'langgraph', 'tools', 'transcription']

/** Who may import whom. An edge added here is an architecture change, not a lint fix. */
export const ENGINE_DEPS = {
  facade: [...LAYERS, 'ports'],
  lambda: ['copilotkit', 'langgraph', 'tools', 'transcription', 'ports'],
  copilotkit: ['langgraph', 'tools', 'ports'],
  langgraph: ['ports'],
  tools: ['ports'],
  transcription: ['ports'],
  ports: [],
}

// `src/__tests__/**` matches no element on purpose: tests reach into every layer and stay unchecked.
const ELEMENTS = [
  // `src/index.ts` and `src/kit.ts` are the package's `exports`; file mode keeps them from claiming `src/`.
  { type: 'facade', mode: 'file', pattern: '**/src/{index,kit}.ts' },
  { type: 'ports', mode: 'file', pattern: '**/src/ports.ts' },
  ...LAYERS.map((type) => ({ type, pattern: `**/src/${type}` })),
  ...VENDORED_ELEMENTS,
]

const policy = (policies) => ({ 'boundaries/dependencies': ['error', { default: 'disallow', policies }] })

export const engineBoundaries = [
  {
    name: 'ai-chat-be/engine-boundaries',
    // Code only: a bare `src/**` also claims data files (a JSON test fixture), which no config gives the
    // `boundaries` plugin, and ESLint then refuses to start.
    files: ['src/**/*.ts'],
    settings: { 'boundaries/elements': ELEMENTS },
    rules: policy([
      ...VENDORED_POLICIES,
      // A layer has no barrel today, so the DAG is enforced between folders, not on entry files.
      ...Object.entries(ENGINE_DEPS)
        .filter(([, deps]) => deps.length > 0)
        .map(([from, deps]) => ({ from: { element: { type: from } }, allow: { to: { element: { type: deps } } } })),
    ]),
  },
]
