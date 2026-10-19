import type { CellRegistry } from '../core/cell-renderer-types'
import { ActionsCell } from './actions-cell'
import { BadgeCell } from './badge-cell'
import { CheckboxSelectCell } from './checkbox-select-cell'
import { ComputedCell } from './computed-cell'
import { CurrencySelectCell } from './currency-select-cell'
import { createCustomCell } from './custom-cell'
import { createExpanderCell } from './expander-cell'
import { NumberInputCell } from './number-input-cell'
import { PriceInputCell } from './price-input-cell'
import { SwitchCell } from './switch-cell'
import { createTextCell } from './text-cell'
import { TextareaCell } from './textarea-cell'

/**
 * The full 12-kind cell registry. `text`/`custom`/`expander` are re-exports of the same renderers
 * the table shell's minimal registry uses — there is exactly one implementation of each — and the
 * other nine are the price/action/selection cells this phase adds. `extra` spreads last so a
 * consumer can override the renderer behind a built-in kind; `CellConfig` is a closed union, so
 * new `kind` strings cannot be registered — `{ kind: 'custom' }` is the escape hatch (see the
 * readme's "Registry extension" section).
 */
export const createCellRegistry = <TData,>(extra?: Partial<CellRegistry<TData>>): CellRegistry<TData> => {
  return {
    text: createTextCell<TData>(),
    custom: createCustomCell<TData>(),
    expander: createExpanderCell<TData>(),
    badge: BadgeCell,
    'number-input': NumberInputCell,
    'price-input': PriceInputCell,
    'currency-select': CurrencySelectCell,
    textarea: TextareaCell,
    switch: SwitchCell,
    computed: ComputedCell,
    actions: ActionsCell,
    'checkbox-select': CheckboxSelectCell,
    ...extra,
  }
}
