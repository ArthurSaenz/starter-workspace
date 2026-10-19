import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import type { ChevronProps } from 'react-day-picker'

import { buttonVariants } from './button'
import { cn } from './cn'

type CalendarChevronProps = ChevronProps

const CalendarChevron = (props: CalendarChevronProps) => {
  const { orientation, className, ...rest } = props

  const Icon = orientation === 'left' ? ChevronLeftIcon : ChevronRightIcon

  return <Icon className={cn('size-4', className)} {...rest} />
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>

const Calendar = (props: CalendarProps) => {
  const { className, classNames, showOutsideDays = true, ...rest } = props

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        // `relative` anchors the absolute nav; `z-10` keeps chevrons above the
        // full-width caption that would otherwise steal their clicks.
        months: 'relative flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-4',
        month_caption: 'relative z-0 flex h-9 w-full items-center justify-center px-10',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 z-10 flex items-center justify-between',
        button_previous: cn(buttonVariants({ variant: 'outline' }), 'size-9 bg-transparent p-0 hover:bg-accent'),
        button_next: cn(buttonVariants({ variant: 'outline' }), 'size-9 bg-transparent p-0 hover:bg-accent'),
        month_grid: 'w-full border-collapse space-x-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-range-start)]:rounded-l-md',
          'first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
        ),
        day_button: cn(buttonVariants({ variant: 'ghost' }), 'size-8 p-0 font-normal aria-selected:opacity-100'),
        range_start: 'day-range-start rounded-l-md',
        range_end: 'day-range-end rounded-r-md',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-accent text-accent-foreground rounded-md',
        outside: 'day-outside text-muted-foreground aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-50',
        range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
      }}
      {...rest}
    />
  )
}

export { Calendar }
