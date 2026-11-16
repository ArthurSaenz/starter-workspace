import { format, isValid, parse } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'

import type { DateRangeFilterConfig } from '../config/filter-config'
import { Button } from '../primitives/button'
import { Calendar } from '../primitives/calendar'
import { cn } from '../primitives/cn'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'

export interface DateRangeFilterProps {
  config: DateRangeFilterConfig
}

/** Bare control for `DateRangeFilterConfig` — the filter bar supplies the label. */
export const DateRangeFilter = (props: DateRangeFilterProps) => {
  const { config } = props

  const { value, onChange, placeholder, className } = config

  const [open, setOpen] = useState(false)

  const selectedRange: DateRange = {
    from: parseFilterDate(value.from),
    to: parseFilterDate(value.to),
  }

  const handleSelect = (range: DateRange | undefined) => {
    onChange({
      from: range?.from ? format(range.from, STORAGE_FORMAT) : undefined,
      to: range?.to ? format(range.to, STORAGE_FORMAT) : undefined,
    })
  }

  // Keyed on the parsed date: a stored string that does not parse has nothing to show.
  const hasValue = selectedRange.from !== undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            TRIGGER_CLASS,
            'w-full justify-start text-left font-normal',
            !hasValue && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">
            {formatRangeLabel(selectedRange) ?? placeholder ?? T.placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" selected={selectedRange} onSelect={handleSelect} autoFocus />
      </PopoverContent>
    </Popover>
  )
}

const STORAGE_FORMAT = 'yyyy-MM-dd'
const DISPLAY_FORMAT = 'MMM d, yyyy'

const parseFilterDate = (value: string | undefined): Date | undefined => {
  if (!value) {
    return undefined
  }

  const parsed = parse(value, STORAGE_FORMAT, new Date())

  return isValid(parsed) ? parsed : undefined
}

const formatRangeLabel = (range: DateRange): string | undefined => {
  if (!range.from) {
    return undefined
  }

  if (!range.to) {
    return format(range.from, DISPLAY_FORMAT)
  }

  return `${format(range.from, DISPLAY_FORMAT)} – ${format(range.to, DISPLAY_FORMAT)}`
}

/** Copied literally from apps/backoffice/ui catalog2-styles.ts CATALOG2_FILTER_TRIGGER_CLASS. */
const TRIGGER_CLASS = 'border-input bg-white h-10 shadow-xs'

const T = {
  placeholder: 'Select date range',
} as const
