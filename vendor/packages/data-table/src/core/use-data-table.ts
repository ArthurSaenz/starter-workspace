import type { ColumnVisibilityState, ExpandedState, RowData, SortingState } from '@tanstack/react-table'
import { useTable } from '@tanstack/react-table'
import { useMemo } from 'react'

import type { CellKind, TableColumnConfig, TableConfig } from '../config'
import type { BuildColumnDefsHelpers } from './build-column-defs'
import { buildColumnDefs, resolveCellRenderer } from './build-column-defs'
import type { CellRegistry } from './cell-renderer-types'
import type { DataTableInstance, DataTableRow } from './table-features'
import { DATA_TABLE_FEATURES } from './table-features'
import { useControllableState } from './use-controllable-state'
import { useLatestRef } from './use-latest-ref'

export interface UseDataTableResult<TData extends RowData> {
  table: DataTableInstance<TData>
  /** id → header label, for the columns-visibility menu. */
  labels: Map<string, string>
}

/**
 * Turns a `TableConfig` into a live TanStack table.
 *
 * Callers may rebuild `config` from scratch on every render — new arrays, new getters, new
 * callbacks. Cells keep their DOM (and their focus) across such a rebuild, and still read the
 * newest getters; see the note above the column-def memo for how.
 */
export const useDataTable = <TData extends RowData>(
  config: TableConfig<TData>,
  cellRegistry: CellRegistry<TData>,
): UseDataTableResult<TData> => {
  const columnsById = useMemo(() => {
    const map = new Map<string, TableColumnConfig<TData>>()

    for (const column of config.columns) {
      map.set(column.id, column)
    }

    return map
  }, [config.columns])

  const columnsByIdRef = useLatestRef(columnsById)
  const columnsRef = useLatestRef(config.columns)
  const registryRef = useLatestRef(cellRegistry)
  const getRowIdRef = useLatestRef(config.getRowId)
  const canExpandRef = useLatestRef(config.expandable?.canExpand)

  const structuralKey = config.columns
    .map((column) => {
      return [
        column.id,
        column.cell.kind,
        column.sortable ? '1' : '0',
        column.hideable === false ? '0' : '1',
        column.sortingValue ? '1' : '0',
        column.size ?? '',
      ].join(':')
    })
    .join('|')

  const { columnDefs, labels } = useMemo(() => {
    const helpers: BuildColumnDefsHelpers<TData> = {
      getColumnConfig: (columnId: string) => {
        return columnsByIdRef.current.get(columnId)
      },
      getCellRenderer: (kind: CellKind) => {
        return resolveCellRenderer(registryRef.current, kind)
      },
    }

    return buildColumnDefs(columnsRef.current, registryRef.current, helpers)
    // `flexRender` hands a column def's `cell` function to `createElement` as the element *type*,
    // so a new cell function is a new component type and React unmounts the old subtree — an
    // `<input>` inside a cell would lose focus after its first character. The defs are therefore
    // keyed on what changes their shape (ids, cell kinds, sorting/hiding/accessor flags) rather
    // than on `config.columns`'s identity, and every config value a cell reads is fetched through
    // a latest-ref at render time. Identity stays put, content stays fresh.
  }, [structuralKey, columnsByIdRef, columnsRef, registryRef])

  const [sorting, onSortingChange] = useControllableState<SortingState>({
    value: config.sorting?.value,
    onChange: config.sorting?.onChange,
    initial: config.sorting?.initial ?? EMPTY_SORTING,
  })

  const [columnVisibility, onColumnVisibilityChange] = useControllableState<ColumnVisibilityState>({
    value: config.columnVisibility?.value,
    onChange: config.columnVisibility?.onChange,
    initial: buildInitialVisibility(config.columnVisibility?.initialHidden),
  })

  const [expanded, onExpandedChange] = useControllableState<ExpandedState>({
    value: config.expandable?.expanded,
    onChange: config.expandable?.onExpandedChange,
    initial: EMPTY_EXPANDED,
  })

  const isExpandable = Boolean(config.expandable)
  const pagination = config.pagination === false ? undefined : config.pagination
  const isClientPagination = pagination?.mode === 'client'
  const serverPagination = pagination?.mode === 'server' ? pagination : undefined

  const getRowCanExpand = useMemo(() => {
    if (!isExpandable) {
      return undefined
    }

    return (row: DataTableRow<TData>) => {
      return canExpandRef.current?.(row.original) ?? true
    }
  }, [isExpandable, canExpandRef])

  const getRowId = useMemo(() => {
    return (row: TData) => {
      return getRowIdRef.current(row)
    }
  }, [getRowIdRef])

  const clientPageSize = isClientPagination ? (pagination.initialPageSize ?? DEFAULT_CLIENT_PAGE_SIZE) : undefined

  const table = useTable<typeof DATA_TABLE_FEATURES, TData>({
    features: DATA_TABLE_FEATURES,
    data: config.data,
    columns: columnDefs,
    // Without a client pager the registered paginated model must not slice `data`: a table with no
    // pagination shows every row, and a server-paged one already holds just the current page.
    manualPagination: !isClientPagination,
    ...(clientPageSize === undefined
      ? {}
      : { initialState: { pagination: { pageIndex: 0, pageSize: clientPageSize } } }),
    // The server owns the slice: the table is told how many pages exist and which one it is
    // looking at, and never slices `data` itself.
    ...(serverPagination
      ? { pageCount: resolvePageCount(serverPagination.totalCount, serverPagination.pageSize) }
      : {}),
    getRowId,
    getRowCanExpand,
    onSortingChange,
    onColumnVisibilityChange,
    onExpandedChange,
    state: {
      sorting,
      columnVisibility,
      expanded,
      ...(serverPagination
        ? {
            pagination: {
              pageIndex: Math.max(0, serverPagination.page - 1),
              pageSize: serverPagination.pageSize,
            },
          }
        : {}),
    },
  })

  return { table, labels }
}

/** `page` is 1-based and `pageSize` arrives from config, so both need a floor before dividing. */
const resolvePageCount = (totalCount: number, pageSize: number): number => {
  return Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)))
}

const buildInitialVisibility = (initialHidden: string[] | undefined): ColumnVisibilityState => {
  if (!initialHidden?.length) {
    return EMPTY_VISIBILITY
  }

  return Object.fromEntries(
    initialHidden.map((columnId) => {
      return [columnId, false]
    }),
  )
}

const DEFAULT_CLIENT_PAGE_SIZE = 10

const EMPTY_SORTING: SortingState = []
const EMPTY_VISIBILITY: ColumnVisibilityState = {}
const EMPTY_EXPANDED: ExpandedState = {}
