import { Trash2 } from 'lucide-react'

import type { ClearAllFilterConfig } from '../config/filter-config'
import { Button } from '../primitives/button'
import { cn } from '../primitives/cn'

export interface ClearAllFilterProps {
  config: ClearAllFilterConfig
}

/** Reset control for `ClearAllFilterConfig` — mirrors the flights search box's Trash2 clear button. */
export const ClearAllFilter = (props: ClearAllFilterProps) => {
  const { config } = props

  const { onClear, label, className } = config

  return (
    <Button type="button" variant="outline" className={cn('h-10 shadow-xs', className)} onClick={onClear}>
      <Trash2 className="mr-2 h-4 w-4" />
      {label ?? T.clear}
    </Button>
  )
}

const T = {
  clear: 'Clear',
} as const
