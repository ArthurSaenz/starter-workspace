import type { ComputedCellConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { cn } from '../primitives/cn'
import { Input } from '../primitives/input'

type ComputedCellProps<TData> = CellRendererProps<TData, ComputedCellConfig<TData>>

/**
 * Read-only derived value. Ported as a disabled numeric input with adornments rather than a plain
 * span: the app's one computed-looking cell, the flights catalog's profit field
 * (flights-catalog-table-cells.tsx `FlightsCatalogSellingCell`), is a disabled `<Input>` with a
 * `%` suffix and a threshold-based red className — the exact shape `ComputedCellConfig` models
 * (`value`/`className`/`prefix`/`suffix`). The market cell in that same file is plain text, but it
 * has no className/adornment logic to port, so the profit field is the representative case.
 */
export const ComputedCell = <TData,>(props: ComputedCellProps<TData>) => {
  const { config, row } = props

  const { value, className, prefix, suffix } = config

  const resolvedClassName = typeof className === 'function' ? className(row) : className
  const resolvedPrefix = typeof prefix === 'function' ? prefix(row) : prefix
  const resolvedSuffix = typeof suffix === 'function' ? suffix(row) : suffix

  return (
    <div className="relative w-20">
      {resolvedPrefix ? (
        <span className="text-muted-foreground absolute top-1/2 left-2 -translate-y-1/2 text-sm">{resolvedPrefix}</span>
      ) : null}
      <Input
        disabled
        readOnly
        type="text"
        value={value(row) ?? ''}
        className={cn(
          'border-input w-20 bg-white text-neutral-600 shadow-xs',
          resolvedPrefix && 'pl-5',
          resolvedSuffix && 'pr-6',
          resolvedClassName,
        )}
      />
      {resolvedSuffix ? (
        <span className="absolute top-1/2 right-2 -translate-y-1/2 text-sm text-pink-500">{resolvedSuffix}</span>
      ) : null}
    </div>
  )
}
