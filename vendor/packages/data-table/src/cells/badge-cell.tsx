import type { BadgeCellConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { Badge } from '../primitives/badge'
import { cn } from '../primitives/cn'

type BadgeCellProps<TData> = CellRendererProps<TData, BadgeCellConfig<TData>>

export const BadgeCell = <TData,>(props: BadgeCellProps<TData>) => {
  const { config, row } = props

  const value = config.value(row)
  const variant = typeof config.variant === 'function' ? config.variant(row) : config.variant
  const className = typeof config.className === 'function' ? config.className(row) : config.className

  return (
    <Badge variant={variant} className={cn(className)}>
      {value ?? ''}
    </Badge>
  )
}
