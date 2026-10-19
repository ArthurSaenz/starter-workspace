// Ported from the backoffice's former components/ui/data-table/data-table-pagination.tsx.
// `mode: 'serverManual'` / `currentPage` in the app map to `mode: 'server'` / `page` here
// (see PaginationConfig) — everything else (DOM, labels, the en-dash row-range string) is
// kept byte-identical.
import type { RowData } from '@tanstack/react-table'
import type { FocusEvent, KeyboardEvent } from 'react'
import { useRef } from 'react'

import type { PaginationConfig, ServerPaginationConfig } from '../config/pagination-config'
import type { DataTableInstance } from '../core/table-features'
import { Button } from '../primitives/button'
import { cn } from '../primitives/cn'
import { Input } from '../primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { ADMIN_PAGE_SIZE_OPTIONS } from './page-size-presets'

export interface DataTablePaginationProps<TData extends RowData> {
  config: PaginationConfig
  table?: DataTableInstance<TData>
  className?: string
}

export const DataTablePagination = <TData extends RowData>(props: DataTablePaginationProps<TData>) => {
  const { config, table, className } = props

  if (config.mode === 'server') {
    return <ServerPagination config={config} className={className} />
  }

  if (!table) {
    throw new Error('DataTablePagination: `table` is required when config.mode is "client"')
  }

  return <ClientPagination table={table} pageSizeOptions={config.pageSizeOptions} className={className} />
}

interface ClientPaginationProps<TData extends RowData> {
  table: DataTableInstance<TData>
  pageSizeOptions?: readonly number[]
  className?: string
}

const ClientPagination = <TData extends RowData>(props: ClientPaginationProps<TData>) => {
  const { table, pageSizeOptions = ADMIN_PAGE_SIZE_OPTIONS, className } = props

  const currentPage = table.store.state.pagination.pageIndex + 1
  const totalPages = table.getPageCount()

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-4', className)}>
      <PageSizeSelect
        pageSize={table.store.state.pagination.pageSize}
        options={pageSizeOptions}
        onPageSizeChange={(value) => {
          table.setPageSize(value)
        }}
      />

      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={table.previousPage} disabled={!table.getCanPreviousPage()}>
            {T.previous}
          </Button>
          <span className="text-muted-foreground text-sm">
            {T.pageOf} {currentPage} {T.of} {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={table.nextPage} disabled={!table.getCanNextPage()}>
            {T.next}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

interface ServerPaginationProps {
  config: ServerPaginationConfig
  className?: string
}

const ServerPagination = (props: ServerPaginationProps) => {
  const { config, className } = props

  const {
    page: currentPage,
    pageSize,
    totalCount,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = ADMIN_PAGE_SIZE_OPTIONS,
    showExtendedControls = true,
    showRowRange = true,
    className: configClassName,
  } = config

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const firstItem = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastItem = Math.min(currentPage * pageSize, totalCount)
  const pageInputRef = useRef<HTMLInputElement>(null)

  const commitPageInput = (value: number) => {
    if (value >= 1 && value <= totalPages) {
      onPageChange(value)
    } else if (pageInputRef.current) {
      pageInputRef.current.value = String(currentPage)
    }
  }

  const handlePageInputBlur = (event: FocusEvent<HTMLInputElement>) => {
    commitPageInput(Number(event.target.value))
  }

  const handlePageInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  const goToFirstPage = () => {
    onPageChange(1)
  }

  const goToLastPage = () => {
    onPageChange(totalPages)
  }

  const goToPrevPage = () => {
    onPageChange(currentPage - 1)
  }

  const goToNextPage = () => {
    onPageChange(currentPage + 1)
  }

  const rowRangeLabel = getRowRangeLabel({ totalCount, firstItem, lastItem })

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4 py-2', configClassName, className)}>
      {showRowRange ? <p className="text-muted-foreground text-sm">{rowRangeLabel}</p> : <div />}

      <div className="flex flex-wrap items-center justify-end gap-4">
        <PageSizeSelect pageSize={pageSize} options={pageSizeOptions} onPageSizeChange={onPageSizeChange} />

        {showExtendedControls && totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToFirstPage} disabled={currentPage <= 1}>
              {T.first}
            </Button>
            <Button variant="outline" size="sm" onClick={goToPrevPage} disabled={currentPage <= 1}>
              {T.previous}
            </Button>
            <Input
              ref={pageInputRef}
              key={currentPage}
              defaultValue={String(currentPage)}
              className="h-8 w-14 text-center"
              aria-label={T.pageInputLabel}
              disabled={totalPages <= 1}
              onBlur={handlePageInputBlur}
              onKeyDown={handlePageInputKeyDown}
            />
            <Button variant="outline" size="sm" onClick={goToNextPage} disabled={currentPage >= totalPages}>
              {T.next}
            </Button>
            <Button variant="outline" size="sm" onClick={goToLastPage} disabled={currentPage >= totalPages}>
              {T.last}
            </Button>
          </div>
        ) : null}

        {!showExtendedControls && totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPrevPage} disabled={currentPage <= 1}>
              {T.previous}
            </Button>
            <span className="text-muted-foreground text-sm">
              {T.pageOf} {currentPage} {T.of} {totalPages}
            </span>
            <Button variant="outline" size="sm" onClick={goToNextPage} disabled={currentPage >= totalPages}>
              {T.next}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface PageSizeSelectProps {
  pageSize: number
  options: readonly number[]
  onPageSizeChange: (value: number) => void
}

const PageSizeSelect = (props: PageSizeSelectProps) => {
  const { pageSize, options, onPageSizeChange } = props

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">{T.rowsPerPage}</span>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => {
          onPageSizeChange(Number(value))
        }}
      >
        <SelectTrigger className="h-8 w-[72px]" aria-label={T.rowsPerPage}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => {
            return (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}

interface RowRangeLabelArgs {
  totalCount: number
  firstItem: number
  lastItem: number
}

const getRowRangeLabel = (args: RowRangeLabelArgs): string => {
  const { totalCount, firstItem, lastItem } = args

  if (totalCount === 0) {
    return T.noItems
  }

  return T.rowRange
    .replace('{first}', String(firstItem))
    .replace('{last}', String(lastItem))
    .replace('{total}', String(totalCount))
}

const T = {
  rowsPerPage: 'Rows per page',
  pageOf: 'Page',
  of: 'of',
  previous: 'Previous',
  next: 'Next',
  first: 'First',
  last: 'Last',
  pageInputLabel: 'Page number',
  noItems: '0 items',
  rowRange: '{first}–{last} of {total} items',
} as const
