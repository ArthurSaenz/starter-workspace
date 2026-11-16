import type { RowData } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import type { MouseEvent, ReactNode } from 'react'
import { Fragment } from 'react'

import type { TableColumnConfig, TableConfig } from '../config'
import type { DataTableInstance, DataTableRow } from '../engine'
import { normalizePageSize } from '../pagination'
import { Skeleton, TableBody, TableCell, TableRow, cn } from '../primitives'
import { resolveRowClassName } from './row-class-name'
import { buildRowContext } from './row-context'

export interface DataTableBodyProps<TData extends RowData> {
  table: DataTableInstance<TData>
  config: TableConfig<TData>
  columnsById: Map<string, TableColumnConfig<TData>>
  colSpan: number
}

/** The `<tbody>`: skeletons while loading, a message when there is nothing to show, otherwise the rows. */
export const DataTableBody = <TData extends RowData>(props: DataTableBodyProps<TData>) => {
  const { table, config, columnsById, colSpan } = props

  const { expandable, messages, rowClassName, onRowClick } = config

  const { rows } = table.getRowModel()

  if (config.isLoading) {
    return <TableBody>{buildSkeletonRows({ rowCount: resolveSkeletonRowCount(config.pagination), colSpan })}</TableBody>
  }

  if (rows.length === 0) {
    const isTableEmpty = config.isEmpty ?? table.getCoreRowModel().rows.length === 0

    return (
      <TableBody>
        <TableRow>
          <TableCell colSpan={colSpan} className="h-24 text-center">
            {isTableEmpty ? (messages?.empty ?? T.emptyState) : (messages?.noResults ?? T.noResults)}
          </TableCell>
        </TableRow>
      </TableBody>
    )
  }

  return (
    <TableBody>
      {rows.map((row, displayIndex) => {
        const resolvedRowClassName = resolveRowClassName(rowClassName, row.original, row.index, displayIndex)
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
      })}
    </TableBody>
  )
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

/** One placeholder row per page row, but never so many that loading becomes a wall of grey. */
const resolveSkeletonRowCount = (pagination: TableConfig<never>['pagination']): number => {
  if (!pagination) {
    return MAX_SKELETON_ROWS
  }

  const pageSize = pagination.mode === 'server' ? pagination.pageSize : pagination.initialPageSize

  return Math.min(normalizePageSize(pageSize ?? MAX_SKELETON_ROWS), MAX_SKELETON_ROWS)
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
} as const
