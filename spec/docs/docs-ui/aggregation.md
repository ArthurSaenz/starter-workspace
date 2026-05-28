---
title: How aggregation works
description: The globs, slug derivation, and frontmatter overrides behind in-place doc aggregation.
---

# How aggregation works

All aggregation logic lives in a single module:
`vendor/packages/docs-ui/src/lib/docs-aggregation.ts`. It is consumed by three callers
inside the docs app:

- `source.config.ts` — tells `fumadocs-mdx` which files to parse.
- `src/lib/source.ts` — maps each file path to its grouped sidebar slug.
- `vite.config.ts` — enumerates every doc URL for prerender seeding.

Keeping all three callers in agreement is why the rules live in one place.

## Repo-root resolution

`createDocsAggregation({ appDir })` walks up from `appDir` until it finds
`pnpm-workspace.yaml`. That directory becomes the repo root for every subsequent glob.

The walk-up means the package keeps working no matter how deep it is vendored — there is
no hardcoded relative path back to the consumer repo.

## Include globs

```ts
const includeGlobs = [
  'apps/*/**/docs/**/*.{md,mdx}',
  'packages/**/docs/**/*.{md,mdx}',
  `${appContentRel}/**/*.{md,mdx}`, // defaults to 'spec/docs/**/*.{md,mdx}'
]
```

Notes:

- The apps glob requires a `docs/` directory nested under `apps/<app>/...`, so the docs
  app's own README and `src/` Markdown are **not** swept in.
- Plain star/globstar only — `fumadocs-mdx`'s globber supports neither `!` negation nor
  extglobs. Negation is handled separately via `ignoreGlobs`.

## Ignore globs

Defensive ignores for paths that pnpm symlinks would normally hide anyway:

```
node_modules, dist, build, .turbo, .source, .output, .nitro, coverage, ios, android
```

## URL derivation

A file path is mapped to a grouped sidebar slug by `pathToSlugs`. Examples:

| File path                             | URL                          |
| ------------------------------------- | ---------------------------- |
| `spec/docs/index.mdx`                 | `/docs`                      |
| `spec/docs/docs-ui/adding-docs.md`    | `/docs/docs-ui/adding-docs`  |
| `apps/ai/agent/docs/draft.md`         | `/docs/ai-agent/draft`       |
| `packages/lib-be-dev/docs/README.md`  | `/docs/lib-be-dev`           |

A single `README.md` or `index.md` directly under a package's `docs/` folder
collapses to the group URL itself — there is no trailing `/readme` segment.

A page can override its URL by setting a `slug:` frontmatter field. The override is read
by both the loader and the prerender enumerator so the static site agrees with the live
routes.

## Prerendering

`getAllDocUrls()` returns every URL the site can serve. Vite uses it to seed the
prerender list at build time, so the output in `.output/public/` contains a real HTML
file for every page — no Node server is required at runtime.
