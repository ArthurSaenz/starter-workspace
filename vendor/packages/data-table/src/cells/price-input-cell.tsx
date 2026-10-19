import type { PriceInputCellConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { cn } from '../primitives/cn'
import { CurrencySelectField } from './currency-select-cell'
import { PriceFieldInput } from './number-input-cell'

type PriceInputCellProps<TData> = CellRendererProps<TData, PriceInputCellConfig<TData>>

/** Multi-field money editor: the flights/packages buying and selling columns' stacked inputs plus an optional currency select. */
export const PriceInputCell = <TData,>(props: PriceInputCellProps<TData>) => {
  const { config, row } = props

  const { fields, currency, wrapperClassName } = config

  return (
    <div className={cn('grid gap-2 border-e-2 border-dotted border-l-zinc-400 pe-2', wrapperClassName)}>
      {fields.map((field) => {
        return <PriceFieldInput key={field.id} field={field} row={row} />
      })}
      {currency ? <CurrencySelectField config={currency} row={row} /> : null}
    </div>
  )
}
