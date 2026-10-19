import type { Column, Row, RowData, Table } from '@tanstack/react-table'
import {
  columnSizingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'

/**
 * Every TanStack feature the table uses, registered once so the object stays stable across renders.
 *
 * The expanded and paginated row models are always registered, even for tables that neither expand
 * nor page: with no `getRowCanExpand` no row expands, and `useDataTable` sets `manualPagination` for
 * any table without a client pager, which makes the paginated model a pass-through.
 *
 * `columnSizingFeature` backs the `size` a column config may set. The sort fns are the three that v8's
 * `'auto'` sort could resolve to; v9 only picks one when it is registered.
 */
export const DATA_TABLE_FEATURES = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
})

export type DataTableFeatures = typeof DATA_TABLE_FEATURES

export type DataTableInstance<TData extends RowData> = Table<DataTableFeatures, TData>

export type DataTableColumn<TData extends RowData, TValue = unknown> = Column<DataTableFeatures, TData, TValue>

export type DataTableRow<TData extends RowData> = Row<DataTableFeatures, TData>
