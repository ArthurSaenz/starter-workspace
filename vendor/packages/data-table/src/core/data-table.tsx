import type { RowData } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import type { ComponentType, MouseEvent, ReactNode } from 'react'
import { Fragment, useMemo } from 'react'

import type { CellRenderContext, FilterConfig, PaginationConfig, TableColumnConfig, TableConfig } from '../config'
import { FilterBar } from '../filters/filter-bar'
import { DataTableFullscreenPortal, DataTableFullscreenToggle, useDataTableFullscreen } from '../fullscreen'
import { DataTablePagination } from '../pagination/data-table-pagination'
import { cn } from '../primitives/cn'
import { Skeleton } from '../primitives/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { TooltipProvider } from '../primitives/tooltip'
import type { CellRegistry, FilterRegistry } from './cell-renderer-types'
import { DataTableRowCount } from './data-table-row-count'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTableViewOptions } from './data-table-view-options'
import { MINIMAL_CELL_REGISTRY } from './minimal-cell-registry'
import { resolveRowClassName } from './row-class-name'
import type { DataTableInstance, DataTableRow } from './table-features'
import { useDataTable } from './use-data-table'

export interface DataTableProps<TData extends RowData> {
  config: TableConfig<TData>
  cellRegistry?: CellRegistry<TData>
  filterRegistry?: FilterRegistry
  components?: DataTableComponents<TData>
}

export const DataTable = <TData extends RowData>(props: DataTableProps<TData>) => {
  const { config, cellRegistry, filterRegistry, components } = props

  const registry = cellRegistry ?? (MINIMAL_CELL_REGISTRY as CellRegistry<TData>)
  const { table, labels } = useDataTable(config, registry)
  const { isFullscreen, toggleFullscreen, exitFullscreen } = useDataTableFullscreen()

  const columnsById = useMemo(() => {
    const map = new Map<string, TableColumnConfig<TData>>()

    config.columns.forEach((column) => {
      map.set(column.id, column)
    })

    return map
  }, [config.columns])

  const { layout, expandable, messages, summary, rowClassName, onRowClick } = config

  const visibleColumnCount = table.getVisibleLeafColumns().length
  const coreRowCount = table.getCoreRowModel().rows.length
  const visibleRowCount = table.getRowModel().rows.length
  const isTableEmpty = config.isEmpty ?? coreRowCount === 0
  const colSpan = visibleColumnCount || config.columns.length

  // The toggle sits beside the view options only when `config.headerActions` is not overridden —
  // same trade-off as the app's `BackofficeDataTableComponent`: a custom `headerActions` loses the
  // built-in button and falls back to Escape / the portal's own close control.
  const defaultHeaderActions = (
    <>
      {config.fullscreen ? <DataTableFullscreenToggle isFullscreen={isFullscreen} onToggle={toggleFullscreen} /> : null}
      <DataTableViewOptions table={table} labels={labels} />
    </>
  )

  const headerActions = config.headerActions ?? defaultHeaderActions

  const FilterBarComponent: ComponentType<DataTableFilterBarProps> = components?.FilterBar ?? FilterBar
  const PaginationComponent: ComponentType<DataTablePaginationProps<TData>> =
    components?.Pagination ?? DataTablePagination

  const filtersNode = config.filters?.length ? (
    <FilterBarComponent filters={config.filters} registry={filterRegistry} />
  ) : null

  // `config.pagination` is `PaginationConfig | false`; both `false` and `undefined` render no
  // pager. This is a deliberate deviation from `BackofficeDataTableComponent`, which defaults an
  // *omitted* pagination prop to a client-mode pager: there `mode` is unset, but here
  // `PaginationConfig` requires an explicit `mode` discriminant, so there is no "empty" config to
  // fall back to without inventing one on the consumer's behalf. A consumer that wants the default
  // client pager asks for it explicitly with `{ mode: 'client' }`.
  const paginationNode = config.pagination ? <PaginationComponent table={table} config={config.pagination} /> : null

  const renderBody = () => {
    if (config.isLoading) {
      return buildSkeletonRows({ rowCount: resolveSkeletonRowCount(config.pagination), colSpan })
    }

    if (visibleRowCount === 0) {
      return (
        <TableRow>
          <TableCell colSpan={colSpan} className="h-24 text-center">
            {isTableEmpty ? (messages?.empty ?? T.emptyState) : (messages?.noResults ?? T.noResults)}
          </TableCell>
        </TableRow>
      )
    }

    return table.getRowModel().rows.map((row) => {
      const resolvedRowClassName = resolveRowClassName(rowClassName, row.original, row.index)
      const isExpanded = row.getIsExpanded()

      return (
        <Fragment key={row.id}>
          <TableRow
            className={cn(resolvedRowClassName, isExpanded && expandable && 'border-b-0')}
            onClick={
              onRowClick
                ? (event: MouseEvent<HTMLTableRowElement>) => {
                    if (isInteractiveTarget(event)) {
                      return
                    }

                    onRowClick(buildRowContext(row, ''))
                  }
                : undefined
            }
          >
            {row.getVisibleCells().map((cell) => {
              return (
                <TableCell
                  key={cell.id}
                  className={cn(
                    'py-3.5 align-top',
                    resolveCellClassName(columnsById.get(cell.column.id), row, cell.column.id),
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              )
            })}
          </TableRow>
          {isExpanded && expandable ? (
            <TableRow className={cn('hover:bg-transparent', resolvedRowClassName, expandable.subRowClassName)}>
              <TableCell colSpan={colSpan} className="p-0 align-top whitespace-normal">
                {/* w-px + min-w-full opts this cell out of the table's max-content width
                    computation - otherwise the sub-row's content (which has no reason to be
                    as wide as an 8-column table) blows out every column, not just its own row. */}
                <div className="w-px min-w-full">{expandable.render(buildRowContext(row, ''))}</div>
              </TableCell>
            </TableRow>
          ) : null}
        </Fragment>
      )
    })
  }

  const isStickyHeader = layout?.stickyHeader ?? true

  const tableScrollArea = (
    <div className={cn('isolate overflow-hidden rounded-md border', isFullscreen && 'flex min-h-0 flex-1 flex-col')}>
      <div className={cn('overflow-auto', resolveScrollAreaHeightClassName({ layout, isFullscreen }))}>
        <table className="w-max min-w-full caption-bottom text-sm">
          {/* The backoffice lifts sticky headers with `var(--z-index-above)` (= 1). The
              package cannot reach that custom property, and the `isolate` wrapper above
              gives this table its own stacking context, so a plain `z-10` is equivalent. */}
          <TableHeader
            className={cn(isStickyHeader && '[&_th]:bg-background shadow-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-10')}
          >
            {table.getHeaderGroups().map((headerGroup) => {
              return (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        className={cn('py-3', columnsById.get(header.column.id)?.headerClassName)}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableHeader>
          <TableBody>{renderBody()}</TableBody>
        </table>
      </div>
    </div>
  )

  const content = (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex flex-col gap-4', layout?.className)}>
        <div className="shrink-0">
          <DataTableToolbar
            toolbar={config.toolbar}
            filters={filtersNode}
            summary={resolveSummaryNode(summary)}
            headerActions={headerActions}
            footer={config.footer}
          />
        </div>
        {tableScrollArea}
        {config.tableFooter ? <div className="shrink-0">{config.tableFooter}</div> : null}
        {paginationNode ? <div className="shrink-0">{paginationNode}</div> : null}
      </div>
    </TooltipProvider>
  )

  if (!config.fullscreen) {
    return content
  }

  const fullscreenConfig = typeof config.fullscreen === 'object' ? config.fullscreen : undefined

  return (
    <>
      {!isFullscreen ? content : null}
      <DataTableFullscreenPortal
        isOpen={isFullscreen}
        title={fullscreenConfig?.title ?? T.fullscreenTitle}
        onClose={exitFullscreen}
        toolbar={headerActions}
        zIndexClassName={fullscreenConfig?.zIndexClassName}
      >
        <TooltipProvider delayDuration={200}>
          {/* `gap-4` here tracks `layout.fillHeight` rather than being unconditional (unlike the
              non-fullscreen wrapper above) — that mismatch is inherited byte-for-byte from
              `BackofficeDataTableComponent`, which the scroll-area height below also always
              overrides to a fixed-viewport `min-h-0 flex-1` regardless of `fillHeight`. */}
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', layout?.fillHeight && 'gap-4')}>
            <div className="shrink-0">
              <DataTableToolbar
                toolbar={config.toolbar}
                filters={filtersNode}
                summary={resolveSummaryNode(summary)}
                footer={config.footer}
              />
            </div>
            {tableScrollArea}
            {config.tableFooter ? <div className="shrink-0">{config.tableFooter}</div> : null}
            {paginationNode ? <div className="shrink-0">{paginationNode}</div> : null}
          </div>
        </TooltipProvider>
      </DataTableFullscreenPortal>
    </>
  )
}

export interface DataTableFilterBarProps {
  filters: FilterConfig[]
  registry?: FilterRegistry
}

export interface DataTablePaginationProps<TData extends RowData> {
  table: DataTableInstance<TData>
  config: PaginationConfig
}

/**
 * The two sub-trees the shell does not own. They are injected rather than imported so the core
 * has no edge to the filters and pagination modules, which are built independently.
 */
export interface DataTableComponents<TData extends RowData> {
  FilterBar?: ComponentType<DataTableFilterBarProps>
  Pagination?: ComponentType<DataTablePaginationProps<TData>>
}

const buildRowContext = <TData extends RowData>(
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
 * A click on a control inside the row belongs to that control. Without this a `checkbox-select`
 * cell would toggle the row and then the row handler would toggle it straight back.
 */
const isInteractiveTarget = (event: MouseEvent<HTMLTableRowElement>): boolean => {
  const target = event.target

  if (!(target instanceof Element)) {
    return false
  }

  return target.closest(INTERACTIVE_TARGET_SELECTOR) !== null
}

const INTERACTIVE_TARGET_SELECTOR =
  'a, button, input, select, textarea, label, [role="checkbox"], [role="switch"], [role="combobox"], [role="menuitem"]'

const resolveCellClassName = <TData extends RowData>(
  column: TableColumnConfig<TData> | undefined,
  row: DataTableRow<TData>,
  columnId: string,
): string | undefined => {
  const { cellClassName } = column ?? {}

  if (typeof cellClassName !== 'function') {
    return cellClassName
  }

  return cellClassName(buildRowContext(row, columnId))
}

const resolveSummaryNode = (summary: TableConfig<never>['summary']): ReactNode => {
  if (!summary) {
    return null
  }

  if (summary.custom) {
    return summary.custom
  }

  if (summary.visibleCount === undefined || summary.totalCount === undefined) {
    return null
  }

  return <DataTableRowCount visibleCount={summary.visibleCount} totalCount={summary.totalCount} />
}

/**
 * `fillHeight` (catalog pages) opts out of the fixed cap so the table grows to its natural content
 * height and the page itself scrolls, with pagination landing at the end of that scroll instead of
 * being squeezed into a tiny internal box. Fullscreen always wins over both: it is a fixed-viewport
 * overlay, so the scroll area is forced to fill it regardless of `fillHeight` or a custom cap —
 * matching `BackofficeDataTableComponent`'s `resolveScrollAreaHeightClassName`.
 */
const resolveScrollAreaHeightClassName = (args: {
  layout: TableConfig<never>['layout']
  isFullscreen: boolean
}): string | false => {
  const { layout, isFullscreen } = args

  if (isFullscreen) {
    return 'min-h-0 flex-1'
  }

  if (layout?.maxHeightClassName) {
    return layout.maxHeightClassName
  }

  if (layout?.fillHeight) {
    return false
  }

  return 'max-h-[min(32rem,calc(100dvh-12rem))]'
}

/** One placeholder row per page row, but never so many that loading becomes a wall of grey. */
const resolveSkeletonRowCount = (pagination: TableConfig<never>['pagination']): number => {
  if (!pagination) {
    return MAX_SKELETON_ROWS
  }

  const pageSize = pagination.mode === 'server' ? pagination.pageSize : pagination.initialPageSize

  return Math.min(pageSize ?? MAX_SKELETON_ROWS, MAX_SKELETON_ROWS)
}

const buildSkeletonRows = (args: { rowCount: number; colSpan: number }): ReactNode => {
  const { rowCount, colSpan } = args

  return Array.from({ length: rowCount }, (_unused, index) => {
    return (
      <TableRow key={`skeleton-${String(index)}`}>
        <TableCell colSpan={colSpan} className="py-3.5">
          <Skeleton className="h-6 w-full" />
        </TableCell>
      </TableRow>
    )
  })
}

const MAX_SKELETON_ROWS = 10

const T = {
  emptyState: 'No results yet.',
  noResults: 'No results match your filters.',
  fullscreenTitle: 'Table',
} as const
