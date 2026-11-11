import { ChevronDown } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '../../primitives/cn'
import { Input } from '../../primitives/input'
import { createKeyDownHandler } from './keyboard'
import { OptionsList } from './options-list'
import { SelectedChips } from './selected-chips'
import {
  areAllOptionsSelected,
  buildExternalKey,
  buildLabelByValue,
  canCreateValue,
  filterOptions,
  resolveCreateError,
  toggleValue,
} from './selection'
import type { MultiSelectComboboxOption } from './types'

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
  const filteredOptions = (searchOptions ?? filterOptions)(options, query)
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
    // Created free-text values are not options, so selecting every option must keep them. The Set
    // also collapses duplicate option values into a single selection.
    const next = isAllSelected ? [] : [...new Set([...value, ...optionValues])]

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

  const isOpen = open && !disabled

  const handleKeyDown = createKeyDownHandler({
    disabled,
    isOpen,
    query,
    value,
    filteredOptions,
    closeOnSelect,
    setOpen,
    setQuery: updateQuery,
    commitToggle,
    commitCreate,
  })

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

const T = {
  placeholder: 'Search…',
} as const
