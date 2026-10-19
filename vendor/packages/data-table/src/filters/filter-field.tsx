import type { ReactNode } from 'react'

import { cn } from '../primitives/cn'
import { Label } from '../primitives/label'

export interface FilterFieldProps {
  label?: string
  children: ReactNode
  className?: string
  /** Reserve label row space without visible text (e.g. action buttons aligned with inputs). */
  hideLabel?: boolean
}

/**
 * Label + width wrapper shared by every filter kind in the bar. Deviates from the ported
 * apps/backoffice/ui Catalog2FilterField, which defaulted a missing `label` to the literal
 * text "Label"; here a missing label (or `hideLabel`) reserves the row's height instead of
 * rendering a placeholder word, which reads better for a general-purpose library component.
 */
export const FilterField = (props: FilterFieldProps) => {
  const { label, children, className, hideLabel = false } = props

  return (
    <div className={cn('grid gap-2', className)}>
      {hideLabel || !label ? (
        <span className="text-xs leading-none opacity-0 select-none" aria-hidden>
          {LABEL_SPACER}
        </span>
      ) : (
        <Label className="text-muted-foreground text-xs leading-none font-semibold">{label}</Label>
      )}
      {children}
    </div>
  )
}

const LABEL_SPACER = 'Label'
