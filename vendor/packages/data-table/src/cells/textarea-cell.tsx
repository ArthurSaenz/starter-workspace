import type { ChangeEvent } from 'react'

import type { TextareaCellConfig } from '../config'
import type { CellRendererProps } from '../core'
import { FIELD_CLASS, Textarea, cn } from '../primitives'

type TextareaCellProps<TData> = CellRendererProps<TData, TextareaCellConfig<TData>>

/** Free-text editor; `slot` renders under it — the comment-pills pattern from the flights/packages catalogs' comment cell. */
export const TextareaCell = <TData,>(props: TextareaCellProps<TData>) => {
  const { config, row } = props

  const { value, onChange, placeholder, className, slot } = config

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ row, value: event.target.value })
  }

  const slotNode = slot?.(row)

  return (
    <div className="flex flex-col">
      <Textarea
        className={cn(TEXTAREA_CELL_CLASS, className)}
        value={value(row)}
        placeholder={placeholder}
        onChange={handleChange}
      />
      {slotNode ? <div className="pt-1.5">{slotNode}</div> : null}
    </div>
  )
}

const TEXTAREA_CELL_CLASS = `${FIELD_CLASS} w-full`
