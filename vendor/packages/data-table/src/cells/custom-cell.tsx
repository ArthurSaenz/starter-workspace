import type { CustomCellConfig } from '../config'
import type { CellRenderer } from '../core/cell-renderer-types'
import { createMinimalCellRegistry } from '../core/minimal-cell-registry'

/**
 * `CustomCell`'s only implementation lives in `core/minimal-cell-registry` — the table shell
 * depends on it directly and cannot depend on this package's full registry. Re-exported here,
 * generic in `TData`, so the full registry has one file per kind without a second implementation.
 */
export const createCustomCell = <TData,>(): CellRenderer<TData, CustomCellConfig<TData>> => {
  return createMinimalCellRegistry<TData>().custom as CellRenderer<TData, CustomCellConfig<TData>>
}
