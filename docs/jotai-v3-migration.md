# Jotai v3 migration — hulyo & travelist

Source: [migrating-to-v3.mdx](https://github.com/pmndrs/jotai/blob/main/docs/guides/migrating-to-v3.mdx).
Surveyed 2026-09-13 against `hulyo-monorepo` (dev) and `travelist-monorepo` (dev).

## What v3 changes

Public hooks (`useAtom`, `useAtomValue`, `useSetAtom`) keep their signatures. What breaks:

| Change                                   | Impact on us                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `loadable` removed from `jotai/utils`    | **Yes** — both repos. Replaced by `loadable` in `@wl/web-toolkit` (this repo).   |
| `exports` map limits entry points        | **Yes** — `jotai/index` (hulyo) and `jotai/vanilla/utils/loadable` (travelist).  |
| `atomFamily` moved to `jotai-family`     | No usage.                                                                        |
| `setSelf` read option removed            | No app usage. The only hit is bundled jotai internals in a tracked IIFE (below). |
| `delay` option on `useAtom*` removed     | No usage.                                                                        |
| `jotai/babel` plugins moved              | No usage.                                                                        |
| ESM only, ES2020 output, `NODE_ENV` read | Vite handles all three; no action.                                               |
| Min React 18 / TS 5.5 / Node 22.12       | Met everywhere: React 19.2.8, TypeScript ^6.0.3, Node 24.21.0.                   |
| `useAtomValue` mount-timing change       | Behavioural only; watch for effects that assumed the pre-mount value.            |

## starter-workspace

Already on `jotai: 3.0.0` (catalog) and installed. No removed API in use. This iteration added the
`loadable` shim to `@wl/web-toolkit` (`vendor/packages/web-toolkit/src/loadable`) and left the
dependency untouched. `pnpm run qa` is green.

## hulyo-monorepo — `jotai: 2.20.3`

### `loadable` (12 call sites, 5 files)

| File                                                       | Calls |
| ---------------------------------------------------------- | ----- |
| `apps/backoffice/ui/src/entities/general-config/model.ts`  | 4     |
| `apps/client/ui/src/core/general-config/model.ts`          | 3     |
| `apps/multivendor/ui/src/entities/general-config/model.ts` | 2     |
| `apps/client/ui/src/mobile/force-update/model.ts`          | 2     |
| `apps/client/ui/src/lib/debug-info/model.ts`               | 1     |

Fix: `import { loadable } from 'jotai/utils'` → `import { loadable } from '@wl/web-toolkit'`.
The returned shape (`state` / `data` / `error`) is identical, so consumers are untouched.

### `jotai/index` imports (11 files) — will not resolve under v3's `exports`

```
apps/backoffice/ui/src/components/default/flight-catalog-row/flight-catalog-row.tsx
apps/backoffice/ui/src/components/default/hotel-catalog-row/hotel-catalog-row.tsx
apps/backoffice/ui/src/components/default/package-catalog-row/package-catalog-row.tsx
apps/backoffice/ui/src/components/default/show-catalog-row/show-catalog-row.tsx
apps/backoffice/ui/src/features/hotels-destination/containers/hotels-destination-container.tsx
apps/backoffice/ui/src/features/one-way-bundles/components/one-way-bundle-row-component.tsx
apps/client/ui/src/features/more-products/containers/more-products-container.tsx
apps/client/ui/src/features/newsletter-plugin/containers/newsletter-plugin-container.tsx
apps/client/ui/src/features/newsletter-plugin/services.ts
apps/client/ui/src/pages/payment-error/+Page.tsx
apps/multivendor/ui/src/features/admin-venues-management/containers/admin-venues-management-container.tsx
```

Fix: `from 'jotai/index'` → `from 'jotai'` (pure rename, same symbols).

### Other

- `jotai-optics ^0.4.0` — peer `jotai >=2.0.0`, works with v3 unchanged.
- `apps/seo/ui/public/widgets/cards-list/cards-list-widget.iife.js` contains `setSelf` — it is
  jotai's own minified runtime inside a tracked build artifact, not app code. Regenerating the widget
  after the bump refreshes it.

## travelist-monorepo — `jotai: 2.20.3`

### `loadable` (26 call sites, 5 files)

| File                                                                 | Calls |
| -------------------------------------------------------------------- | ----- |
| `packages/general-config/src/configs-manifest/service.ts`            | 21    |
| `apps/client/ui/src/mobile/force-update/model.ts`                    | 2     |
| `apps/client/ui/src/features/sponsored-banner/services/service.ts`   | 1     |
| `apps/client/ui/src/features/debug-info/service.ts`                  | 1     |
| `apps/client/ui/src/features/lead-campaign-form/services/service.ts` | 1     |

Fix: same one-line import swap to `@wl/web-toolkit`.

### Deep type import (1 file)

`apps/client/ui/src/features/lead-campaign-form/services/service.ts`:
`import type { Loadable } from 'jotai/vanilla/utils/loadable'` →
`import type { Loadable } from '@wl/web-toolkit'`.

### Behaviour to keep in mind

`use-lead-campaign-from-url.ts` (and its test) depend on `loadable` handing back a **new snapshot
object** after a refetch. The shim preserves that: a fresh `{ state: 'hasData', data }` object is
produced on every recompute, while `loadable($x)` itself stays referentially stable per source atom
(WeakMap-memoised, as in v2).

## Migration order

1. Sync `@wl/web-toolkit` from this repo into both monorepos (`vendor/packages/web-toolkit`).
2. Swap the `loadable` / `Loadable` imports and the `jotai/index` paths listed above.
3. Bump `jotai` to `3.0.0` in each `pnpm-workspace.yaml` catalog, `pnpm install`, run `qa`.

The shim compiles against both jotai 2.x and 3.x (`unwrap` exists in both), so step 2 can land
before step 3.
