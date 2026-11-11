import { X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '../../primitives/badge'
import { cn } from '../../primitives/cn'

interface SelectedChipsProps {
  value: string[]
  labelByValue: Map<string, string>
  disabled?: boolean
  onRemove: (value: string) => void
}

export const SelectedChips = (props: SelectedChipsProps) => {
  const { value, labelByValue, disabled, onRemove } = props

  const [isExpanded, setIsExpanded] = useState(false)
  const shouldCollapse = value.length > COLLAPSED_CHIP_THRESHOLD

  if (!shouldCollapse && isExpanded) {
    setIsExpanded(false)
  }

  if (value.length === 0) {
    return null
  }

  const isCollapsed = shouldCollapse && !isExpanded

  return (
    <div className="pt-1">
      {/* Toggle sits above the chips so collapsing an expanded wall never needs a scroll back down. */}
      {shouldCollapse ? (
        <button
          type="button"
          className="mb-1 text-sm text-violet-700 underline underline-offset-2 hover:text-violet-800"
          onClick={() => {
            setIsExpanded((prev) => {
              return !prev
            })
          }}
        >
          {isExpanded ? T.showLess : T.showMore}
        </button>
      ) : null}

      <div className={cn('flex flex-wrap gap-1', isCollapsed && 'max-h-[5.5rem] overflow-hidden')}>
        {value.map((v) => {
          const chipLabel = labelByValue.get(v) ?? v

          return (
            <Badge
              key={v}
              variant="secondary"
              className={cn(
                'gap-1 rounded-xl border-transparent bg-pink-400 font-medium text-white',
                !disabled && 'pr-1',
              )}
            >
              {chipLabel}
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`${T.removePrefix}${chipLabel}`}
                  // Prevent the mousedown from stealing focus / blurring the input,
                  // which (in browsers that don't focus buttons on click) would close
                  // the open dropdown when de-selecting a value via its chip.
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    onRemove(v)
                  }}
                  className="rounded-full text-white hover:opacity-70"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          )
        })}
      </div>
    </div>
  )
}

const T = {
  removePrefix: 'Remove ',
  showMore: 'Show more',
  showLess: 'Show less',
} as const

const COLLAPSED_CHIP_THRESHOLD = 50
