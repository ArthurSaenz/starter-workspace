import { X } from 'lucide-react'

import type { SelectFilterConfig } from '../config'
import { FILTER_TRIGGER_CLASS, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '../primitives'

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

const SELECT_TRIGGER_CLASS = `${FILTER_TRIGGER_CLASS} w-full min-w-[140px]`

const T = {
  clear: 'Clear',
} as const
