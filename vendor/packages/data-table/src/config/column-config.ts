import type { RowData } from '@tanstack/react-table'
import type { ReactNode } from 'react'

import type { DataTableColumn, DataTableInstance } from '../core/table-features'
import type { CellConfig, CellRenderContext } from './cell-config'

export interface ColumnHeaderRenderContext<TData extends RowData> {
  column: DataTableColumn<TData>
  table: DataTableInstance<TData>
  label: string
}

/**
 * One column of the table.
 *
 * `label` is both the header text and the entry in the columns-visibility menu — the package
 * keeps its own id→label map rather than augmenting TanStack's `ColumnMeta`.
 *
 * `sortingValue` is the scalar the sort comparator runs on. Without it a `sortable` column has
 * nothing to compare, since cells read their data through getters rather than accessor paths.
 *
 * `header` replaces the built-in sortable header for this column (the visibility menu still uses
 * `label`) — the escape hatch for headers with tooltips, sr-only text, or consumer-owned sort UI.
 */
export interface TableColumnConfig<TData extends RowData> {
  id: string
  label: string
  cell: CellConfig<TData>
  header?: (ctx: ColumnHeaderRenderContext<TData>) => ReactNode
  sortable?: boolean
  sortingValue?: (row: TData) => string | number
  hideable?: boolean
  size?: number
  headerClassName?: string
  cellClassName?: string | ((ctx: CellRenderContext<TData>) => string | undefined)
}
