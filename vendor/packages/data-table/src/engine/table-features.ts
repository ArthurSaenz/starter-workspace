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
  sortFn_basic,
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
 * `columnSizingFeature` backs the `size` a column config may set.
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
})

export type DataTableFeatures = typeof DATA_TABLE_FEATURES

export type DataTableInstance<TData extends RowData> = Table<DataTableFeatures, TData>

export type DataTableColumn<TData extends RowData, TValue = unknown> = Column<DataTableFeatures, TData, TValue>

export type DataTableRow<TData extends RowData> = Row<DataTableFeatures, TData>

const RE_SPLIT_ALPHANUMERIC = /(\d+)/gm

const resolvedSortFns = new WeakMap<readonly unknown[], Map<string, typeof sortFn_basic>>()

/**
 * The sort fn of every sortable column: v8's `'auto'` resolution, so client-sorted tables keep the
 * order they had on v8. v8 sampled `flatRows.slice(10)` — the rows after the first ten — and v9's
 * `'auto'` samples the first ten, so the two disagree whenever those windows hold different kinds of
 * value; a table of ten rows or fewer always got v8's case-sensitive `basic`.
 *
 * Resolved once per row model and column: the comparator runs O(n log n) times per sort.
 */
export const sortFn_v8Auto = <TData extends RowData>(
  rowA: DataTableRow<TData>,
  rowB: DataTableRow<TData>,
  columnId: string,
): number => {
  const { flatRows } = rowA.table.getFilteredRowModel()

  let byColumn = resolvedSortFns.get(flatRows)

  if (!byColumn) {
    byColumn = new Map()
    resolvedSortFns.set(flatRows, byColumn)
  }

  let sortFn = byColumn.get(columnId)

  if (!sortFn) {
    sortFn = resolveV8AutoSortFn(flatRows, columnId)
    byColumn.set(columnId, sortFn)
  }

  return sortFn(rowA, rowB, columnId)
}

const resolveV8AutoSortFn = <TData extends RowData>(
  flatRows: DataTableRow<TData>[],
  columnId: string,
): typeof sortFn_basic => {
  let isString = false

  for (const row of flatRows.slice(10)) {
    const value = row.getValue(columnId)

    if (Object.prototype.toString.call(value) === '[object Date]') {
      return sortFn_datetime
    }

    if (typeof value === 'string') {
      isString = true

      if (value.split(RE_SPLIT_ALPHANUMERIC).length > 1) {
        return sortFn_alphanumeric
      }
    }
  }

  return isString ? sortFn_text : sortFn_basic
}
