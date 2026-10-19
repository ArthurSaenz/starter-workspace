import type { ReactNode } from 'react'

import { cn } from '../primitives/cn'

export interface DataTableToolbarProps {
  toolbar?: ReactNode
  filters?: ReactNode
  summary?: ReactNode
  headerActions?: ReactNode
  footer?: ReactNode
  className?: string
}

export const DataTableToolbar = (props: DataTableToolbarProps) => {
  const { toolbar, filters, summary, headerActions, footer, className } = props

  const hasToolbarRow = Boolean(toolbar) || Boolean(headerActions)
  const hasFiltersRow = Boolean(filters)
  const hasSummary = Boolean(summary)
  const hasFooter = Boolean(footer)

  if (!hasToolbarRow && !hasFiltersRow && !hasSummary && !hasFooter) {
    return null
  }

  return (
    <div className={cn('space-y-3', className)}>
      {hasToolbarRow ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : <span />}
          {headerActions ? <div className="flex flex-wrap items-center justify-end gap-2">{headerActions}</div> : null}
        </div>
      ) : null}
      {hasFiltersRow || hasSummary ? (
        <div className="flex flex-col gap-3">
          {hasFiltersRow ? <div className="flex flex-wrap items-start gap-2">{filters}</div> : null}
          {summary}
        </div>
      ) : null}
      {hasFooter ? footer : null}
    </div>
  )
}
