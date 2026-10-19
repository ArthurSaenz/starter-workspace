import type { Column, Table } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, ListRestart } from 'lucide-react'
import type { HTMLAttributes } from 'react'

import { Button } from '../primitives/button'
import { cn } from '../primitives/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'

export interface DataTableColumnHeaderProps<TData, TValue> extends HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>
  table?: Table<TData>
  title: string
}

/**
 * Sortable column header.
 *
 * The title opens a menu rather than toggling the sort directly. A plain toggle cycles asc -> desc
 * -> asc with no way back to the table's natural order, so once an operator clicks a header they are
 * stuck with a sorted view for the rest of the session; it also gives no indication of what the next
 * click will do. The menu names each direction and offers Reset, which restores whatever order the
 * data arrived in — meaningful for tables whose incoming order carries information, such as the
 * async-operations monitor, where the server already returns the newest-started operation first.
 */
export const DataTableColumnHeader = <TData, TValue>(props: DataTableColumnHeaderProps<TData, TValue>) => {
  const { column, table, title, className, ...rest } = props

  if (!column.getCanSort()) {
    return (
      <div className={cn('flex items-center gap-1.5', className)} {...rest}>
        <span className="text-sm font-medium">{title}</span>
      </div>
    )
  }

  const sortDirection = column.getIsSorted()
  const hasAnySort = table ? table.getState().sorting.length > 0 : Boolean(sortDirection)
  const ariaSort = sortDirection ? ARIA_SORT_BY_DIRECTION[sortDirection] : 'none'

  const handleSortAscClick = () => {
    column.toggleSorting(false)
  }

  const handleSortDescClick = () => {
    column.toggleSorting(true)
  }

  const handleClearClick = () => {
    if (table) {
      table.resetSorting()

      return
    }

    column.clearSorting()
  }

  const renderSortIcon = () => {
    if (sortDirection === 'desc') {
      return <ArrowDown />
    }

    if (sortDirection === 'asc') {
      return <ArrowUp />
    }

    return <ChevronsUpDown className="text-muted-foreground opacity-50" />
  }

  return (
    <div className={cn('flex items-center', className)} aria-sort={ariaSort} {...rest}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="data-[state=open]:bg-accent -ml-3 h-8 gap-1.5 px-2"
            aria-label={`${T.sortBy}: ${title}`}
          >
            <span>{title}</span>
            {renderSortIcon()}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={handleSortAscClick}>
            <ArrowUp className="text-muted-foreground" />
            {T.asc}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSortDescClick}>
            <ArrowDown className="text-muted-foreground" />
            {T.desc}
          </DropdownMenuItem>
          {/* Offered only when something is actually sorted — otherwise it resets nothing. */}
          {hasAnySort ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleClearClick}>
                <ListRestart className="text-muted-foreground" />
                {T.clear}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const ARIA_SORT_BY_DIRECTION = {
  asc: 'ascending',
  desc: 'descending',
} as const

const T = {
  sortBy: 'Sort by',
  asc: 'Asc',
  desc: 'Desc',
  clear: 'Clear',
} as const
