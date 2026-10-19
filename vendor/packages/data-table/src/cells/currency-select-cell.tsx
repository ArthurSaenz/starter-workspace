import type { CurrencySelectCellConfig, CurrencySelectConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { cn } from '../primitives/cn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { CELL_FIELD_CLASS } from './number-input-cell'

export interface CurrencySelectFieldProps<TData> {
  config: CurrencySelectConfig<TData>
  row: TData
  className?: string
}

/** The currency `<Select>` under a price cell — shared by `price-input` and the standalone `currency-select` kind. */
export const CurrencySelectField = <TData,>(props: CurrencySelectFieldProps<TData>) => {
  const { config, row, className } = props

  const { value, onChange, options, triggerSize = 'sm', triggerClassName } = config

  const handleValueChange = (nextValue: string) => {
    onChange({ row, value: nextValue })
  }

  return (
    <Select value={value(row)} onValueChange={handleValueChange}>
      <SelectTrigger className={cn(CURRENCY_SELECT_TRIGGER_CLASS, className, triggerClassName)} size={triggerSize}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          return (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

/**
 * Currency select trigger width to match the price fields it sits beside. Follows the `w-20`
 * sizing used on the currency trigger in the flights catalog's buying/selling cells
 * (apps/backoffice/ui/.../flights-catalog-table-cells.tsx), layered on the same white field
 * styling the price inputs beside it use.
 */
const CURRENCY_SELECT_TRIGGER_CLASS = `${CELL_FIELD_CLASS} w-20`

type CurrencySelectCellProps<TData> = CellRendererProps<TData, CurrencySelectCellConfig<TData>>

export const CurrencySelectCell = <TData,>(props: CurrencySelectCellProps<TData>) => {
  const { config, row } = props

  const { className, ...selectConfig } = config

  return <CurrencySelectField config={selectConfig} row={row} className={className} />
}
