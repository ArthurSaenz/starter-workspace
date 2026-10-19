import type { OnChangeFn, SortingState, VisibilityState } from '@tanstack/react-table'
import type { ReactNode } from 'react'

import type { CellRenderContext } from './cell-config'
import type { TableColumnConfig } from './column-config'
import type { ExpandableConfig } from './expandable-config'
import type { FilterConfig } from './filter-config'
import type { PaginationConfig } from './pagination-config'
import type { RowClassNameConfig } from './row-class-name-config'

/**
 * Sorting is uncontrolled when only `initial` is given and controlled when `value`/`onChange`
 * are, so a container that keeps sort state in Jotai and one that does not share a shape.
 */
export interface TableSortingConfig {
  initial?: SortingState
  value?: SortingState
  onChange?: OnChangeFn<SortingState>
}

/** `initialHidden` lists column ids hidden on first render; `value`/`onChange` control it. */
export interface TableColumnVisibilityConfig {
  initialHidden?: string[]
  value?: VisibilityState
  onChange?: OnChangeFn<VisibilityState>
}

export interface TableFullscreenConfig {
  title?: string
  zIndexClassName?: string
}

/**
 * `fillHeight` lets the table grow to its content height so the page scrolls (catalog pages);
 * without it the body is capped and scrolls internally.
 */
export interface TableLayoutConfig {
  fillHeight?: boolean
  stickyHeader?: boolean
  maxHeightClassName?: string
  className?: string
}

/** The "showing N of M" line above the table; `custom` replaces it outright. */
export interface TableSummaryConfig {
  visibleCount?: number
  totalCount?: number
  custom?: ReactNode
}

/** `empty` shows when there is no data at all, `noResults` when filters excluded everything. */
export interface TableMessagesConfig {
  empty?: string
  noResults?: string
}

/**
 * The whole table, declared in one object: no JSX required to get columns, filters, paging,
 * sorting, visibility, expansion and row styling.
 *
 * `getRowId` must be stable per row — it keys rows, expansion and (via `checkbox-select`)
 * selection across re-renders and page changes.
 *
 * `pagination: false` renders no pager at all.
 *
 * `onRowClick` makes the whole row a target (a picker dialog that selects on row click). Clicks
 * that land on a control inside the row — a checkbox, button, link or input — are left to that
 * control, so a `checkbox-select` cell and the row handler never both fire for one click.
 */
export interface TableConfig<TData> {
  data: TData[]
  getRowId: (row: TData) => string
  columns: TableColumnConfig<TData>[]
  filters?: FilterConfig[]
  pagination?: PaginationConfig | false
  sorting?: TableSortingConfig
  columnVisibility?: TableColumnVisibilityConfig
  expandable?: ExpandableConfig<TData>
  rowClassName?: RowClassNameConfig<TData>
  onRowClick?: (ctx: CellRenderContext<TData>) => void
  fullscreen?: boolean | TableFullscreenConfig
  layout?: TableLayoutConfig
  summary?: TableSummaryConfig
  messages?: TableMessagesConfig
  isEmpty?: boolean
  isLoading?: boolean
  headerActions?: ReactNode
  toolbar?: ReactNode
  footer?: ReactNode
  /** Rendered between the table and the pagination row — e.g. a consumer-owned pager. */
  tableFooter?: ReactNode
}
