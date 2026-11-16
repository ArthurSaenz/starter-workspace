import type { RowData } from '@tanstack/react-table'

import type { CellRenderContext } from '../config'
import type { DataTableRow } from '../engine'

/** The one place a TanStack row becomes the context consumers see; `columnId` is '' for row-level callers. */
export const buildRowContext = <TData extends RowData>(
  row: DataTableRow<TData>,
  columnId: string,
): CellRenderContext<TData> => {
  return {
    row: row.original,
    rowIndex: row.index,
    isExpanded: row.getIsExpanded(),
    toggleExpanded: () => {
      row.toggleExpanded()
    },
    columnId,
  }
}
