import type {
  AccessorFnColumnDef,
  CellContext,
  ColumnDef,
  DisplayColumnDef,
  HeaderContext,
  RowData,
} from '@tanstack/react-table'

import type { CellKind, CellRenderContext, TableColumnConfig } from '../config'
import type { CellRegistry, CellRenderer } from './cell-renderer-types'
import { DataTableColumnHeader } from './data-table-column-header'
import { sortFn_v8Auto } from './table-features'
import type { DataTableFeatures, DataTableRow } from './table-features'

type ColumnHeaderContext<TData extends RowData> = HeaderContext<DataTableFeatures, TData, unknown>

type ColumnCellContext<TData extends RowData> = CellContext<DataTableFeatures, TData, unknown>

/**
 * Live lookups that let a memoized column def read the newest config.
 *
 * `buildColumnDefs` is pure and the defs it returns are meant to outlive many renders, so the
 * closures inside them must not be the only path to the consumer's getters and callbacks — those
 * are rebuilt every render by containers that assemble their config inline. When `useDataTable`
 * supplies these, every cell resolves its config and renderer at render time through refs;
 * without them the defs fall back to the snapshot they were built from, which is what a direct
 * caller (and the unit tests) wants.
 */
export interface BuildColumnDefsHelpers<TData extends RowData> {
  getColumnConfig?: (columnId: string) => TableColumnConfig<TData> | undefined
  getCellRenderer?: (kind: CellKind) => CellRenderer<TData> | undefined
}

export interface BuildColumnDefsResult<TData extends RowData> {
  columnDefs: ColumnDef<DataTableFeatures, TData>[]
  /** id → header label, consumed by the columns-visibility menu. */
  labels: Map<string, string>
}

const buildCellRenderContext = <TData extends RowData>(
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

/**
 * Translates the declarative column configs into TanStack column defs.
 *
 * A column only gets an `accessorFn` when it declares `sortingValue`: cells read their data
 * through getters rather than accessor paths, so a column without one has nothing to sort on and
 * is a display column as far as the table is concerned.
 *
 * An unknown `cell.kind` renders a visible error string in the cell rather than throwing. A throw
 * during render takes the whole table down over one misconfigured column, while the failure is a
 * config typo that the operator can see and the developer can read straight off the screen.
 */
export const buildColumnDefs = <TData extends RowData>(
  columns: TableColumnConfig<TData>[],
  registry: CellRegistry<TData>,
  helpers: BuildColumnDefsHelpers<TData> = {},
): BuildColumnDefsResult<TData> => {
  const labels = new Map<string, string>()

  const columnDefs = columns.map((snapshot): ColumnDef<DataTableFeatures, TData> => {
    const columnId = snapshot.id

    labels.set(columnId, snapshot.label)

    const resolveConfig = () => {
      return helpers.getColumnConfig?.(columnId) ?? snapshot
    }

    const base: DisplayColumnDef<DataTableFeatures, TData, unknown> = {
      id: columnId,
      size: snapshot.size,
      enableSorting: snapshot.sortable ?? false,
      enableHiding: snapshot.hideable ?? true,
      header: (headerContext: ColumnHeaderContext<TData>) => {
        const { column, table } = headerContext

        const config = resolveConfig()

        if (config.header) {
          return config.header({ column, table, label: config.label })
        }

        return <DataTableColumnHeader column={column} table={table} title={config.label} />
      },
      cell: (cellContext: ColumnCellContext<TData>) => {
        const { row } = cellContext

        const cellConfig = resolveConfig().cell
        const Renderer = helpers.getCellRenderer?.(cellConfig.kind) ?? resolveCellRenderer(registry, cellConfig.kind)

        if (!Renderer) {
          return <span className="text-destructive text-sm">{`${T.unknownCellKind} "${cellConfig.kind}"`}</span>
        }

        return <Renderer config={cellConfig} ctx={buildCellRenderContext(row, columnId)} row={row.original} />
      },
    }

    if (!snapshot.sortingValue) {
      return base
    }

    const sortable: AccessorFnColumnDef<DataTableFeatures, TData, unknown> = {
      ...base,
      accessorFn: (row: TData) => {
        return resolveConfig().sortingValue?.(row) ?? ''
      },
      sortFn: sortFn_v8Auto,
    }

    return sortable
  })

  return { columnDefs, labels }
}

/**
 * The registry is a mapped type keyed by discriminant, so each entry's config parameter is
 * narrower than the `CellConfig` union a runtime lookup can produce. The lookup is sound — the
 * key comes from the very config being rendered — but only the caller knows that, hence the cast.
 */
export const resolveCellRenderer = <TData extends RowData>(
  registry: CellRegistry<TData>,
  kind: CellKind,
): CellRenderer<TData> | undefined => {
  return registry[kind] as CellRenderer<TData> | undefined
}

const T = {
  unknownCellKind: 'Unknown cell kind:',
} as const
