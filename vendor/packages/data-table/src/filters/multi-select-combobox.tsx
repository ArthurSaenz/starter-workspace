import { Check, ChevronDown, X } from 'lucide-react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Badge } from '../primitives/badge'
import { cn } from '../primitives/cn'
import { Input } from '../primitives/input'
import { DATA_TABLE_POPOVER_Z_INDEX } from '../primitives/z-index'

export interface MultiSelectComboboxProps {
  /** Currently selected values. */
  value: string[]
  /** Commits the next selection. */
  onChange: (next: string[]) => void
  /** Selectable options. */
  options: MultiSelectComboboxOption[]
  placeholder?: string
  /** When set, the query can be added as a free-text value. */
  allowCreate?: boolean
  /** Returns null when the raw query is a valid creation, else an error string. */
  validateCreate?: (raw: string) => string | null
  /** When true, shows a Select all / Deselect all row at the top of the list. */
  showSelectAll?: boolean
  /** When true, blocks search, selection, and chip removal (edit dialog read-only fields). */
  disabled?: boolean
  /** When true, closes the dropdown after picking an option from the list (catalog filter UX). */
  closeOnSelect?: boolean
  /** When true, shows a dropdown chevron to indicate select behavior (category fields). */
  showDropdownIndicator?: boolean
  /** Optional class names applied to the search input. */
  inputClassName?: string
  /**
   * Receives every typed query, for callers that fetch extra options remotely. When set, an option-set
   * change no longer resets the query, so results arriving mid-typing keep the list open.
   */
  onQueryChange?: (query: string) => void
  /**
   * Overrides the built-in substring filter (`filterOptions`) with a custom search, e.g. a
   * match-sorter fuzzy match. Defaults to `filterOptions`.
   */
  searchOptions?: (options: MultiSelectComboboxOption[], query: string) => MultiSelectComboboxOption[]
  /** Overrides the portaled list's default class-based stacking (`z-[DATA_TABLE_POPOVER_Z_INDEX]`). */
  portalZIndexClassName?: string
  /** Overrides/extends the portaled list's inline style, applied after the default z-index. */
  portalZIndexStyle?: CSSProperties
  id?: string
  className?: string
}

/**
 * @description Searchable multi-select combobox built from shadcn primitives only
 * (Input + a filtered `<ul>` dropdown) — no popover/command dependency. Selected
 * values render as removable chips; the list filters by value OR label and toggles
 * selection on click. With `allowCreate`, a valid non-empty query can be appended
 * as a free-text value. Mirrors the destination-combobox idiom, including the
 * "adjust state during render" resync to external `value`/`options` changes.
 */
export const MultiSelectCombobox = (props: MultiSelectComboboxProps) => {
  const {
    value,
    onChange,
    options,
    placeholder,
    allowCreate,
    validateCreate,
    showSelectAll,
    disabled,
    closeOnSelect = false,
    id,
    className,
    showDropdownIndicator = true,
    inputClassName,
    searchOptions,
    portalZIndexClassName,
    portalZIndexStyle,
    onQueryChange,
  } = props

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastEmittedValueKeyRef = useRef<string | null>(null)
  const hasPendingQueryResetRef = useRef(false)

  const valueKey = value.join('\u0001')
  const externalKey = onQueryChange ? valueKey : buildExternalKey(valueKey, options)
  const [syncedKey, setSyncedKey] = useState(externalKey)

  // Resync (close + clear the query) when the form value or option set changes
  // externally (dialog reset, duplicate prefill) — the documented "adjust state
  // during render" pattern, which avoids an effect round-trip.
  if (externalKey !== syncedKey) {
    setSyncedKey(externalKey)

    if (valueKey !== lastEmittedValueKeyRef.current) {
      setQuery('')
      setOpen(false)
      hasPendingQueryResetRef.current = true
    }
  }

  // The parent cannot be updated during this render, so the resync's query reset reaches it after commit.
  useEffect(() => {
    if (hasPendingQueryResetRef.current) {
      hasPendingQueryResetRef.current = false
      onQueryChange?.('')
    }
  })

  const updateQuery = (next: string) => {
    setQuery(next)
    onQueryChange?.(next)
  }

  const trimmedQuery = query.trim()
  const filteredOptions = (searchOptions ?? filterOptions)(options, query).slice(0, MAX_VISIBLE_OPTIONS)
  const labelByValue = buildLabelByValue(options)
  const optionValues = new Set(
    options.map((option) => {
      return option.value
    }),
  )
  const selectedValues = new Set(value)
  const createError = resolveCreateError(allowCreate, trimmedQuery, validateCreate)
  const canCreate = canCreateValue({
    allowCreate,
    trimmedQuery,
    createError,
    optionValues,
    selectedValues,
  })
  const isAllSelected = areAllOptionsSelected(value, options)
  const shouldShowSelectAll = Boolean(showSelectAll) && options.length > 0 && trimmedQuery.length === 0

  const commitSelection = (next: string[]) => {
    lastEmittedValueKeyRef.current = next.join('\u0001')
    onChange(next)
    // A pick ends the search, so the parent must not run a lookup for the query typed before it.
    onQueryChange?.('')
  }

  const commitToggle = (v: string) => {
    commitSelection(toggleValue(value, v))

    if (closeOnSelect) {
      setOpen(false)
      updateQuery('')
    }
  }

  const commitSelectAll = () => {
    const next = isAllSelected
      ? []
      : options.map((option) => {
          return option.value
        })

    commitSelection(next)
    updateQuery('')
    setOpen(false)
  }

  const commitCreate = () => {
    if (!canCreate) {
      return
    }

    commitSelection(toggleValue(value, trimmedQuery))
    updateQuery('')

    if (closeOnSelect) {
      setOpen(false)
    }
  }

  const handleKeyDown = createKeyDownHandler({
    disabled,
    query,
    value,
    filteredOptions,
    closeOnSelect,
    setOpen,
    setQuery: updateQuery,
    commitToggle,
    commitCreate,
  })

  const isOpen = open && !disabled
  const shouldShowList = isOpen && (filteredOptions.length > 0 || canCreate || shouldShowSelectAll)

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Input
          id={id}
          value={query}
          autoComplete="off"
          placeholder={placeholder ?? T.placeholder}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          disabled={disabled}
          className={cn(inputClassName, showDropdownIndicator && 'pr-9')}
          onChange={(event) => {
            updateQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (!disabled) {
              setOpen(true)
            }
          }}
          // Selecting an option can close the list while leaving focus on the input (commitToggle
          // and commitSelectAll both call setOpen(false)). Focus alone would then never fire again,
          // so clicking the already-focused input has to reopen the list on its own.
          onClick={() => {
            if (!disabled) {
              setOpen(true)
            }
          }}
          onBlur={(event) => {
            // Keep the list open while focus stays inside the combobox (clicking an
            // option or chip); only close when focus leaves the whole control.
            if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
              setOpen(false)
            }
          }}
          onKeyDown={handleKeyDown}
        />
        {showDropdownIndicator ? (
          <ChevronDown
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50"
            aria-hidden
          />
        ) : null}
      </div>

      <SelectedChips value={value} labelByValue={labelByValue} disabled={disabled} onRemove={commitToggle} />

      {createError ? <p className="text-destructive mt-1 text-xs">{createError}</p> : null}

      {shouldShowList ? (
        <OptionsList
          anchorRef={containerRef}
          shouldShowSelectAll={shouldShowSelectAll}
          isAllSelected={isAllSelected}
          filteredOptions={filteredOptions}
          selectedValues={selectedValues}
          canCreate={canCreate}
          trimmedQuery={trimmedQuery}
          onSelectAll={commitSelectAll}
          onToggle={commitToggle}
          onCreate={commitCreate}
          portalZIndexClassName={portalZIndexClassName}
          portalZIndexStyle={portalZIndexStyle}
        />
      ) : null}
    </div>
  )
}

export interface MultiSelectComboboxOption {
  value: string
  label: string
  /** Secondary line shown under the label in the list only (not on the chip). */
  description?: string
}

interface SelectedChipsProps {
  value: string[]
  labelByValue: Map<string, string>
  disabled?: boolean
  onRemove: (value: string) => void
}

const SelectedChips = (props: SelectedChipsProps) => {
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

      {shouldCollapse ? (
        <button
          type="button"
          className="mt-1 text-sm text-violet-700 underline underline-offset-2 hover:text-violet-800"
          onClick={() => {
            setIsExpanded((prev) => {
              return !prev
            })
          }}
        >
          {isExpanded ? T.showLess : T.showMore}
        </button>
      ) : null}
    </div>
  )
}

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

const OptionsList = (props: OptionsListProps) => {
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

interface CreateKeyDownHandlerArgs {
  disabled?: boolean
  query: string
  value: string[]
  filteredOptions: MultiSelectComboboxOption[]
  closeOnSelect?: boolean
  setOpen: (open: boolean) => void
  setQuery: (query: string) => void
  commitToggle: (value: string) => void
  commitCreate: () => void
}

const createKeyDownHandler = (args: CreateKeyDownHandlerArgs) => {
  const { disabled, query, value, filteredOptions, closeOnSelect, setOpen, setQuery, commitToggle, commitCreate } = args

  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      return
    }

    if (event.key === 'Escape') {
      setOpen(false)

      return
    }

    if (event.key === 'Backspace' && query === '' && value.length > 0) {
      commitToggle(value[value.length - 1] as string)

      return
    }

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()

    const first = filteredOptions[0]

    if (first) {
      commitToggle(first.value)

      if (!closeOnSelect) {
        setQuery('')
      }

      return
    }

    commitCreate()
  }
}

const buildExternalKey = (valueKey: string, options: MultiSelectComboboxOption[]): string => {
  return `${valueKey}|${options
    .map((option) => {
      return option.value
    })
    .join('\u0001')}`
}

const buildLabelByValue = (options: MultiSelectComboboxOption[]): Map<string, string> => {
  return new Map(
    options.map((option) => {
      return [option.value, option.label]
    }),
  )
}

const resolveCreateError = (
  allowCreate: boolean | undefined,
  trimmedQuery: string,
  validateCreate: ((raw: string) => string | null) | undefined,
): string | null => {
  if (!allowCreate || trimmedQuery.length === 0) {
    return null
  }

  return validateCreate?.(trimmedQuery) ?? null
}

interface CanCreateValueArgs {
  allowCreate?: boolean
  trimmedQuery: string
  createError: string | null
  optionValues: Set<string>
  selectedValues: Set<string>
}

const canCreateValue = (args: CanCreateValueArgs): boolean => {
  const { allowCreate, trimmedQuery, createError, optionValues, selectedValues } = args

  return (
    Boolean(allowCreate) &&
    trimmedQuery.length > 0 &&
    createError === null &&
    !optionValues.has(trimmedQuery) &&
    !selectedValues.has(trimmedQuery)
  )
}

/**
 * @description Pure helper: filters `options` by value OR label, case-insensitive.
 * An empty/whitespace query returns all options.
 * @example
 * filterOptions([{ value: 'AA', label: 'Alpha' }], 'al') // [{ value: 'AA', label: 'Alpha' }]
 */
export const filterOptions = (options: MultiSelectComboboxOption[], query: string): MultiSelectComboboxOption[] => {
  const trimmed = query.trim().toLowerCase()

  if (trimmed.length === 0) {
    return options
  }

  return options.filter((option) => {
    return option.value.toLowerCase().includes(trimmed) || option.label.toLowerCase().includes(trimmed)
  })
}

/**
 * @description Pure helper: adds `v` if absent, removes it if present, no duplicates.
 * @example
 * toggleValue(['a'], 'b') // ['a', 'b']
 * toggleValue(['a', 'b'], 'a') // ['b']
 */
export const toggleValue = (value: string[], v: string): string[] => {
  if (value.includes(v)) {
    return value.filter((existing) => {
      return existing !== v
    })
  }

  return [...value, v]
}

/**
 * @description Pure helper: true when every option value is present in `value`.
 * @example
 * areAllOptionsSelected(['a', 'b'], [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]) // true
 * areAllOptionsSelected(['a'], [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]) // false
 */
export const areAllOptionsSelected = (value: string[], options: MultiSelectComboboxOption[]): boolean => {
  if (options.length === 0) {
    return false
  }

  const selected = new Set(value)

  return options.every((option) => {
    return selected.has(option.value)
  })
}

export const MULTI_SELECT_COMBOBOX_LIST_SLOT = 'multi-select-combobox-list'

export const isMultiSelectComboboxListEvent = (event: { target: EventTarget | null }): boolean => {
  return (
    event.target instanceof Element && event.target.closest(`[data-slot="${MULTI_SELECT_COMBOBOX_LIST_SLOT}"]`) !== null
  )
}

const T = {
  placeholder: 'Search…',
  addPrefix: 'Add ',
  removePrefix: 'Remove ',
  selectAll: 'Select all',
  deselectAll: 'Deselect all',
  showMore: 'Show more',
  showLess: 'Show less',
} as const

const MAX_VISIBLE_OPTIONS = 100
const COLLAPSED_CHIP_THRESHOLD = 50
