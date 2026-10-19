import type { ChangeEvent, FocusEvent } from 'react'

import type { NumberInputCellConfig, PriceFieldConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { cn } from '../primitives/cn'
import { Input } from '../primitives/input'

export interface PriceFieldInputProps<TData> {
  field: PriceFieldConfig<TData>
  row: TData
}

/**
 * One editable numeric field — the `w-20` labelled/unlabelled input the flights and packages
 * catalogs stack per passenger type. Shared by `number-input` (one field) and `price-input`
 * (several fields) so there is exactly one implementation of a price field.
 */
export const PriceFieldInput = <TData,>(props: PriceFieldInputProps<TData>) => {
  const { field, row } = props

  const {
    id,
    domId,
    label,
    value,
    onChange,
    onBlur,
    className,
    inputClassName,
    idAttribute = 'id',
    disabled,
    placeholder,
  } = field

  const isDisabled = typeof disabled === 'function' ? disabled(row) : (disabled ?? false)
  const resolvedDomId = domId?.(row) ?? id
  const idProps = idAttribute === 'name' ? { name: resolvedDomId } : { id: resolvedDomId }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ row, value: event.target.value })
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    onBlur?.({ row, value: event.target.value })
  }

  return (
    <div className={cn('grid gap-1', className)}>
      {label ? <span className="text-sm font-semibold">{label}</span> : null}
      <Input
        {...idProps}
        type="number"
        placeholder={placeholder}
        disabled={isDisabled}
        className={cn(CELL_FIELD_CLASS, 'w-20', inputClassName)}
        value={value(row) ?? ''}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  )
}

/**
 * Consistent white field styling for editable table cells. Copied from
 * apps/backoffice/ui/.../catalog2-styles.ts `CATALOG2_FIELD_CLASS` — the package cannot import
 * from the app, so the class string is vendored here as the single package-owned constant.
 */
export const CELL_FIELD_CLASS = 'border-input bg-white shadow-xs'

type NumberInputCellProps<TData> = CellRendererProps<TData, NumberInputCellConfig<TData>>

export const NumberInputCell = <TData,>(props: NumberInputCellProps<TData>) => {
  const { config, row } = props

  return (
    <div className={cn(config.wrapperClassName)}>
      <PriceFieldInput field={config.field} row={row} />
    </div>
  )
}
