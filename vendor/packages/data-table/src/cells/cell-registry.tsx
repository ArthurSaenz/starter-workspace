import type { CellRegistry } from '../core'
import { CustomCell, ExpanderCell, TextCell } from '../core'
import { mergeOverrides } from '../registry'
import { ActionsCell } from './actions-cell'
import { BadgeCell } from './badge-cell'
import { CheckboxSelectCell } from './checkbox-select-cell'
import { ComputedCell } from './computed-cell'
import { CurrencySelectCell } from './currency-select-cell'
import { NumberInputCell } from './number-input-cell'
import { PriceInputCell } from './price-input-cell'
import { SwitchCell } from './switch-cell'
import { TextareaCell } from './textarea-cell'

/**
 * The full 12-kind cell registry. `text`/`custom`/`expander` are the renderers of the table shell's
 * minimal registry, which cannot depend on this module. `extra` is applied last so a
 * consumer can override the renderer behind a built-in kind; `CellConfig` is a closed union, so
 * new `kind` strings cannot be registered — `{ kind: 'custom' }` is the escape hatch (see the
 * readme's "Registry extension" section).
 */
export const createCellRegistry = <TData,>(extra?: Partial<CellRegistry<TData>>): CellRegistry<TData> => {
  // `Required` turns a kind added to `CellConfig` without a renderer here into a compile error,
  // instead of an "Unknown cell kind" cell at runtime.
  const builtIns = {
    text: TextCell,
    custom: CustomCell,
    expander: ExpanderCell,
    badge: BadgeCell,
    'number-input': NumberInputCell,
    'price-input': PriceInputCell,
    'currency-select': CurrencySelectCell,
    textarea: TextareaCell,
    switch: SwitchCell,
    computed: ComputedCell,
    actions: ActionsCell,
    'checkbox-select': CheckboxSelectCell,
  } satisfies Required<CellRegistry<TData>>

  return mergeOverrides<CellRegistry<TData>>(builtIns, extra)
}
