'use client'

import * as React from 'react'

import { cn } from './cn'

const Table = (props: React.ComponentProps<'table'>) => {
  const { className, ...rest } = props

  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...rest} />
    </div>
  )
}

const TableHeader = (props: React.ComponentProps<'thead'>) => {
  const { className, ...rest } = props

  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...rest} />
}

const TableBody = (props: React.ComponentProps<'tbody'>) => {
  const { className, ...rest } = props

  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...rest} />
}

const TableFooter = (props: React.ComponentProps<'tfoot'>) => {
  const { className, ...rest } = props

  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...rest}
    />
  )
}

const TableRow = (props: React.ComponentProps<'tr'>) => {
  const { className, ...rest } = props

  return (
    <tr
      data-slot="table-row"
      className={cn('hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors', className)}
      {...rest}
    />
  )
}

const TableHead = (props: React.ComponentProps<'th'>) => {
  const { className, ...rest } = props

  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...rest}
    />
  )
}

const TableCell = (props: React.ComponentProps<'td'>) => {
  const { className, ...rest } = props

  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...rest}
    />
  )
}

const TableCaption = (props: React.ComponentProps<'caption'>) => {
  const { className, ...rest } = props

  return <caption data-slot="table-caption" className={cn('text-muted-foreground mt-4 text-sm', className)} {...rest} />
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow }
