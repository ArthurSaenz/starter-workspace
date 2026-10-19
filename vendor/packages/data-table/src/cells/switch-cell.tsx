import type { SwitchCellConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { cn } from '../primitives/cn'
import { Switch } from '../primitives/switch'

type SwitchCellProps<TData> = CellRendererProps<TData, SwitchCellConfig<TData>>

export const SwitchCell = <TData,>(props: SwitchCellProps<TData>) => {
  const { config, row } = props

  const { checked, onToggle, className, disabled } = config

  const isDisabled = typeof disabled === 'function' ? disabled(row) : (disabled ?? false)

  const handleCheckedChange = (nextChecked: boolean) => {
    onToggle({ row, checked: nextChecked })
  }

  return (
    <Switch
      checked={checked(row)}
      disabled={isDisabled}
      className={cn(className ?? ACTIVE_SWITCH_CLASS)}
      onCheckedChange={handleCheckedChange}
    />
  )
}

/**
 * Green when active, red when inactive — the default look, overridable via `config.className`.
 * Copied from apps/backoffice/ui/.../catalog2-styles.ts `CATALOG2_ACTIVE_SWITCH_CLASS`.
 */
const ACTIVE_SWITCH_CLASS = 'data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-red-500'
