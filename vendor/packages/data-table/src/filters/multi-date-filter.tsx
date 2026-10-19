import { format, isValid, parse } from 'date-fns'
import { CalendarIcon, X } from 'lucide-react'
import { useState } from 'react'

import type { MultiDateFilterConfig } from '../config/filter-config'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Calendar } from '../primitives/calendar'
import { cn } from '../primitives/cn'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'

export interface MultiDateFilterProps {
  config: MultiDateFilterConfig
}

/** Bare control for `MultiDateFilterConfig` — the filter bar supplies the label. */
export const MultiDateFilter = (props: MultiDateFilterProps) => {
  const { config } = props

  const { values, onChange, availableDates, dateFormat = DEFAULT_DATE_FORMAT, placeholder, className } = config

  const [open, setOpen] = useState(false)

  const availableDateSet = availableDates && availableDates.length > 0 ? new Set(availableDates) : null

  const isDateDisabled = (date: Date) => {
    if (!availableDateSet) {
      return false
    }

    return !availableDateSet.has(format(date, dateFormat))
  }

  const selectedDates = values
    .map((dateString) => {
      return parseFilterDate(dateString, dateFormat)
    })
    .filter((date): date is Date => {
      return date !== undefined
    })

  const handleSelect = (dates: Date[] | undefined) => {
    onChange(
      (dates ?? []).map((date) => {
        return format(date, dateFormat)
      }),
    )
  }

  const handleRemove = (dateString: string) => {
    onChange(
      values.filter((existing) => {
        return existing !== dateString
      }),
    )
  }

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              FILTER_TRIGGER_CLASS,
              'w-full shrink-0 justify-start text-left font-normal',
              values.length === 0 && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="size-4 shrink-0" />
            <span className="truncate">
              {values.length > 0 ? T.selectedCount(values.length) : (placeholder ?? T.placeholder)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="pointer-events-auto w-auto p-0" align="start">
          <Calendar
            mode="multiple"
            selected={selectedDates}
            onSelect={handleSelect}
            disabled={isDateDisabled}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {values.length > 0 ? (
        <div className="flex w-full flex-wrap gap-1">
          {values.map((dateString) => {
            return (
              <Badge
                key={dateString}
                variant="secondary"
                className="gap-1 rounded-xl border-transparent bg-pink-400 pr-1 font-medium text-white"
              >
                {dateString}
                <button
                  type="button"
                  aria-label={`${T.removePrefix}${dateString}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    handleRemove(dateString)
                  }}
                  className="rounded-full text-white hover:opacity-70"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const parseFilterDate = (value: string, dateFormat: string): Date | undefined => {
  const parsed = parse(value, dateFormat, new Date())

  return isValid(parsed) ? parsed : undefined
}

const DEFAULT_DATE_FORMAT = 'yyyy-MM-dd'

/** Copied literally from apps/backoffice/ui catalog2-styles.ts CATALOG2_FILTER_TRIGGER_CLASS. */
const FILTER_TRIGGER_CLASS = 'border-input bg-white h-10 shadow-xs'

const T = {
  placeholder: 'Select dates',
  removePrefix: 'Remove ',
  selectedCount: (count: number) => {
    return `${count} selected`
  },
} as const
