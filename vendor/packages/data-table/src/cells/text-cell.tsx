import type { TextCellConfig } from '../config'
import type { CellRenderer } from '../core/cell-renderer-types'
import { createMinimalCellRegistry } from '../core/minimal-cell-registry'

/**
 * `TextCell`'s only implementation lives in `core/minimal-cell-registry` — the table shell depends
 * on it directly and cannot depend on this package's full registry. Re-exported here, generic in
 * `TData`, so the full registry has one file per kind without a second implementation.
 */
export const createTextCell = <TData,>(): CellRenderer<TData, TextCellConfig<TData>> => {
  return createMinimalCellRegistry<TData>().text as CellRenderer<TData, TextCellConfig<TData>>
}
