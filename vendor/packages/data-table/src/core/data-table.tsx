import type { RowData } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import type { ComponentType, ReactNode } from 'react'
import { useState } from 'react'

import type { FilterConfig, PaginationConfig, TableConfig } from '../config'
import type { DataTableInstance } from '../engine'
import type { FilterRegistry, SearchDrafts } from '../filters'
import { FilterBar, SearchDraftsContext } from '../filters'
import { DataTableFullscreenPortal, DataTableFullscreenToggle, useDataTableFullscreen } from '../fullscreen'
import { DataTablePagination } from '../pagination'
import { TableHead, TableHeader, TableRow, TooltipProvider, cn } from '../primitives'
import type { CellRegistry } from './cell-renderer-types'
import { DataTableBody } from './data-table-body'
import { DataTableRowCount } from './data-table-row-count'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTableViewOptions } from './data-table-view-options'
import { MINIMAL_CELL_REGISTRY } from './minimal-cell-registry'
import { useDataTable } from './use-data-table'

export interface DataTableProps<TData extends RowData> {
  config: TableConfig<TData>
  cellRegistry?: CellRegistry<TData>
  filterRegistry?: Partial<FilterRegistry>
  components?: DataTableComponents<TData>
}

export const DataTable = <TData extends RowData>(props: DataTableProps<TData>) => {
  const { config, cellRegistry, filterRegistry, components } = props

  const registry = cellRegistry ?? (MINIMAL_CELL_REGISTRY as CellRegistry<TData>)
  const { table, labels, columnsById } = useDataTable(config, registry)
  const { isFullscreen, toggleFullscreen, exitFullscreen } = useDataTableFullscreen()

  const [searchDrafts] = useState<SearchDrafts>(() => {
    return new Map()
  })

  const { layout, summary } = config

  const visibleColumnCount = table.getVisibleLeafColumns().length
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
          <DataTableBody table={table} config={config} columnsById={columnsById} colSpan={colSpan} />
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
    <SearchDraftsContext value={searchDrafts}>
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
    </SearchDraftsContext>
  )
}

export interface DataTableFilterBarProps {
  filters: FilterConfig[]
  registry?: Partial<FilterRegistry>
}

export interface DataTablePaginationProps<TData extends RowData> {
  table: DataTableInstance<TData>
  config: PaginationConfig
}

/** Replacements for the two sub-trees the shell does not own; each defaults to the package's own. */
export interface DataTableComponents<TData extends RowData> {
  FilterBar?: ComponentType<DataTableFilterBarProps>
  Pagination?: ComponentType<DataTablePaginationProps<TData>>
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

const T = {
  fullscreenTitle: 'Table',
} as const
