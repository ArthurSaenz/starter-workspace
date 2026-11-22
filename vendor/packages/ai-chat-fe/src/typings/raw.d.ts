// `?raw` imports (vite) — `catalogue-readme.test.ts` reads the package README as a string, and
// `import.meta.glob` (features.test.ts) needs the `ImportMeta` augmentation from the same client typings.
/// <reference types="vite/client" />
declare module '*?raw' {
  const content: string

  export default content
}
