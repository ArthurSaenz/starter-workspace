/**
 * Client-side paging: the table holds every row and slices it itself.
 * Used by the shows selection dialog, which loads one page of deals and pages within it.
 */
export interface ClientPaginationConfig {
  mode: 'client'
  pageSizeOptions?: readonly number[]
  initialPageSize?: number
}

/**
 * Server-driven paging — mirrors `DataTablePaginationServerManualProps` in the backoffice
 * (`the backoffice's former components/ui/data-table/data-table-pagination.tsx`), which the
 * catalogs already feed from Jotai.
 *
 * `page` is **1-based**: it is the app's `currentPage`, and `onPageChange` is called with the
 * same 1-based number (First → 1, Last → `ceil(totalCount / pageSize)`).
 *
 * `showExtendedControls` (default true in the app) picks the First/Prev/page-input/Next/Last
 * bar over the plain Prev/"Page N of M"/Next bar. `showRowRange` (default true) toggles the
 * "21–40 of 100 items" label.
 */
export interface ServerPaginationConfig {
  mode: 'server'
  page: number
  pageSize: number
  totalCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  pageSizeOptions?: readonly number[]
  showExtendedControls?: boolean
  showRowRange?: boolean
  className?: string
}

export type PaginationConfig = ClientPaginationConfig | ServerPaginationConfig

export type PaginationMode = PaginationConfig['mode']
