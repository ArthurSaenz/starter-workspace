import { X } from 'lucide-react'

import type { SelectFilterConfig } from '../config/filter-config'
import { cn } from '../primitives/cn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'

export interface SelectFilterProps {
  config: SelectFilterConfig
}

/** Bare control for `SelectFilterConfig` — the filter bar supplies the label. */
export const SelectFilter = (props: SelectFilterProps) => {
  const { config } = props

  const { value, onChange, options, placeholder, allowClear, className } = config

  const canClear = Boolean(allowClear) && value.length > 0

  return (
    <div className={cn('relative', className)}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, canClear && 'pr-8')}>
          <SelectValue placeholder={placeholder} />
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
      {canClear ? (
        <button
          type="button"
          aria-label={T.clear}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-8 -translate-y-1/2 rounded-full p-0.5"
          onClick={() => {
            onChange('')
          }}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

/** Copied literally from apps/backoffice/ui catalog2-styles.ts CATALOG2_FILTER_SELECT_TRIGGER_CLASS — do not import across the app boundary. */
const SELECT_TRIGGER_CLASS = 'border-input bg-white h-10 w-full min-w-[140px] shadow-xs'

const T = {
  clear: 'Clear',
} as const
