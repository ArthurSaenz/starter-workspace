import { cn } from '../primitives/cn'

export interface DataTableRowCountProps {
  visibleCount: number
  totalCount: number
  className?: string
}

export const DataTableRowCount = (props: DataTableRowCountProps) => {
  const { visibleCount, totalCount, className } = props

  return (
    <p className={cn('text-muted-foreground text-sm', className)}>
      {T.rowsVisible.replace('{n}', String(visibleCount)).replace('{total}', String(totalCount))}
    </p>
  )
}

const T = {
  rowsVisible: '{n} of {total} row(s) visible.',
} as const
