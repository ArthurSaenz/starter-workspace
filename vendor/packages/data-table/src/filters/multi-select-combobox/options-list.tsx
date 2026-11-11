import { Check } from 'lucide-react'
import type { CSSProperties, RefObject } from 'react'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../primitives/cn'
import { DATA_TABLE_POPOVER_Z_INDEX } from '../../primitives/z-index'
import { MULTI_SELECT_COMBOBOX_LIST_SLOT } from './list-slot'
import type { MultiSelectComboboxOption } from './types'

interface OptionsListProps {
  anchorRef: RefObject<HTMLDivElement | null>
  shouldShowSelectAll: boolean
  isAllSelected: boolean
  filteredOptions: MultiSelectComboboxOption[]
  selectedValues: Set<string>
  canCreate: boolean
  trimmedQuery: string
  onSelectAll: () => void
  onToggle: (value: string) => void
  onCreate: () => void
  portalZIndexClassName?: string
  portalZIndexStyle?: CSSProperties
}

export const OptionsList = (props: OptionsListProps) => {
  const {
    anchorRef,
    shouldShowSelectAll,
    isAllSelected,
    filteredOptions,
    selectedValues,
    canCreate,
    trimmedQuery,
    onSelectAll,
    onToggle,
    onCreate,
    portalZIndexClassName,
    portalZIndexStyle,
  } = props

  const [position, setPosition] = useState<DropdownPosition | null>(null)

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current

      if (!anchor) {
        return
      }

      const rect = anchor.getBoundingClientRect()

      setPosition({
        top: rect.bottom + DROPDOWN_OFFSET_PX,
        left: rect.left,
        width: rect.width,
      })
    }

    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, filteredOptions.length, shouldShowSelectAll, canCreate, trimmedQuery])

  if (!position) {
    return null
  }

  const list = (
    <ul
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        // Inline: Radix modal dialogs set pointer-events:none on body. The list
        // is portaled to body, so a class-only override can lose the cascade.
        pointerEvents: 'auto',
        ...(portalZIndexClassName ? {} : { zIndex: DATA_TABLE_POPOVER_Z_INDEX }),
        ...portalZIndexStyle,
      }}
      data-slot={MULTI_SELECT_COMBOBOX_LIST_SLOT}
      className={cn(
        'bg-popover text-popover-foreground pointer-events-auto fixed max-h-60 overflow-auto rounded-md border p-1 shadow-md',
        portalZIndexClassName,
      )}
      role="listbox"
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      // Radix modal dialogs lock scrolling (react-remove-scroll) with a bubble-phase `wheel` listener on
      // document that cancels events outside DialogContent — including this body-portaled list. React's
      // root listener runs first, so stopping propagation here keeps the list's native wheel scroll.
      onWheel={(event) => {
        event.stopPropagation()
      }}
    >
      {shouldShowSelectAll ? (
        <li role="option" aria-selected={isAllSelected}>
          <button
            type="button"
            className={cn(
              'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-start text-sm font-medium',
              isAllSelected && 'bg-accent text-accent-foreground',
            )}
            // onMouseDown fires before the input blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault()
              onSelectAll()
            }}
          >
            <span className="truncate">{isAllSelected ? T.deselectAll : T.selectAll}</span>
            {isAllSelected ? <Check className="size-4 shrink-0" /> : null}
          </button>
        </li>
      ) : null}

      {filteredOptions.map((option) => {
        const isSelected = selectedValues.has(option.value)

        return (
          <li key={option.value} role="option" aria-selected={isSelected}>
            <button
              type="button"
              className={cn(
                'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-start text-sm',
                isSelected && 'bg-accent text-accent-foreground',
              )}
              // onMouseDown fires before the input blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault()
                onToggle(option.value)
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.description ? (
                  <span className="text-muted-foreground truncate text-xs">{option.description}</span>
                ) : null}
              </span>
              {isSelected ? <Check className="size-4 shrink-0" /> : null}
            </button>
          </li>
        )
      })}

      {canCreate ? (
        <li role="option" aria-selected={false}>
          <button
            type="button"
            className="hover:bg-accent hover:text-accent-foreground flex w-full items-center rounded-sm px-2 py-1.5 text-start text-sm"
            onMouseDown={(event) => {
              event.preventDefault()
              onCreate()
            }}
          >
            {T.addPrefix}&quot;{trimmedQuery}&quot;
          </button>
        </li>
      ) : null}
    </ul>
  )

  return createPortal(list, document.body)
}

interface DropdownPosition {
  top: number
  left: number
  width: number
}

const DROPDOWN_OFFSET_PX = 4

const T = {
  addPrefix: 'Add ',
  selectAll: 'Select all',
  deselectAll: 'Deselect all',
} as const
