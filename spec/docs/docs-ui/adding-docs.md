---
title: Adding docs
description: How to publish a new page in the aggregated docs site.
---

# Adding docs

The docs site is convention-driven. There is no registration step — any Markdown or MDX
file placed in a recognised location is picked up on the next build.

## Recognised locations

1. **Repo-root landing content** — `spec/docs/**/*.{md,mdx}`
   Use this for cross-cutting docs that do not belong to a single package.
2. **App docs** — `apps/<app>/**/docs/**/*.{md,mdx}`
   Each app's own docs, grouped under the app's name in the sidebar.
3. **Package docs** — `packages/<pkg>/docs/**/*.{md,mdx}`
   Each package's own docs, grouped under the package's name in the sidebar.

## Steps

1. Create a `docs/` directory inside your app or package, or add a new file under
   `spec/docs/`.
2. Drop in a `.md` or `.mdx` file. Frontmatter is optional:

   ```mdx
   ---
   title: My Page
   description: One-line summary used in search and the sidebar.
   ---

   Page body here.
   ```

3. Rebuild the docs app: `pnpm --filter @wl/docs-ui build`. The page appears under its
   package group in the sidebar.

## Frontmatter overrides

| Field         | Default                              | Notes                                           |
| ------------- | ------------------------------------ | ----------------------------------------------- |
| `title`       | Derived from the file path           | Overrides the auto-derived heading.             |
| `description` | (none)                               | Used in search results and page metadata.       |
| `slug`        | Derived from the file path           | Use to force a specific URL (e.g. `api/v2/auth`). |

## Sidebar ordering

To control the sidebar order inside a folder, add a `meta.json`:

```json
{
  "title": "My section",
  "pages": ["index", "adding-docs", "aggregation"]
}
```

Files not listed in `pages` are appended alphabetically.
