// Vendored from the backoffice's former components/ui/data-table/page-size-presets.ts (deleted once every table moved here) and
// apps/backoffice/ui/src/lib/pagination-options — keep these literals in sync with the app.

/** Catalog screens (flights, packages, shows, hotels). */
export const CATALOG_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100, 200, 300, 400] as const

/** Admin / management tables with smaller page sizes. */
export const ADMIN_PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 15, 25, 50] as const

export type CatalogPageSize = (typeof CATALOG_PAGE_SIZE_OPTIONS)[number]

export type AdminPageSize = (typeof ADMIN_PAGE_SIZE_OPTIONS)[number]
