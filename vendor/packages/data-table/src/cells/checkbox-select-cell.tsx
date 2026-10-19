import type { CheckboxSelectCellConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { Checkbox } from '../primitives/checkbox'
import { cn } from '../primitives/cn'

type CheckboxSelectCellProps<TData> = CellRendererProps<TData, CheckboxSelectCellConfig<TData>>

/** Controlled row selection — the consumer owns the selected set, matching the shows catalog's selection checkbox. */
export const CheckboxSelectCell = <TData,>(props: CheckboxSelectCellProps<TData>) => {
  const { config, row } = props

  const { isSelected, onToggle, disabled, ariaLabel, className } = config

  const isDisabled = disabled?.(row) ?? false

  const handleCheckedChange = () => {
    onToggle(row)
  }

  return (
    <Checkbox
      checked={isSelected(row)}
      disabled={isDisabled}
      aria-label={ariaLabel?.(row)}
      className={cn(SELECTION_CHECKBOX_CLASS, className)}
      onCheckedChange={handleCheckedChange}
    />
  )
}

/**
 * Pink checked state matching legacy catalog checkboxes. Copied from
 * apps/backoffice/ui/.../catalog2-styles.ts `CATALOG2_CHECKBOX_CLASS`.
 */
const SELECTION_CHECKBOX_CLASS =
  'data-[state=checked]:border-pink-400 data-[state=checked]:bg-pink-400 data-[state=checked]:text-white'
