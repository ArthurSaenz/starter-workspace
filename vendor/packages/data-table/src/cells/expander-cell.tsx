import type { ExpanderCellConfig } from '../config'
import type { CellRenderer } from '../core/cell-renderer-types'
import { createMinimalCellRegistry } from '../core/minimal-cell-registry'

/**
 * `ExpanderCell`'s only implementation lives in `core/minimal-cell-registry` — the table shell
 * depends on it directly and cannot depend on this package's full registry. Re-exported here,
 * generic in `TData`, so the full registry has one file per kind without a second implementation.
 */
export const createExpanderCell = <TData,>(): CellRenderer<TData, ExpanderCellConfig> => {
  return createMinimalCellRegistry<TData>().expander as CellRenderer<TData, ExpanderCellConfig>
}
