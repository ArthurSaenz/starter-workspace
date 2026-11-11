import { Search } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { SearchFilterConfig } from '../config/filter-config'
import { cn } from '../primitives/cn'
import { Input } from '../primitives/input'
import { debounce } from './lib/debounce'
import { SearchDraftsContext } from './search-drafts'

export interface SearchFilterProps {
  config: SearchFilterConfig
}

/** Bare control for `SearchFilterConfig` — the filter bar supplies the label. */
export const SearchFilter = (props: SearchFilterProps) => {
  const { config } = props

  const { id, value, onChange, placeholder, debounceMs, className, name, ariaLabel } = config

  const drafts = useContext(SearchDraftsContext)

  const [localValue, setLocalValue] = useState(() => {
    return drafts?.get(id)?.text ?? value
  })

  const onChangeRef = useRef(onChange)
  const lastEmittedRef = useRef(value)

  onChangeRef.current = onChange

  const debouncedOnChange = useMemo(() => {
    if (!debounceMs) {
      return undefined
    }

    return debounce((nextValue: string) => {
      drafts?.delete(id)
      lastEmittedRef.current = nextValue
      onChangeRef.current(nextValue)
    }, debounceMs)
  }, [debounceMs, drafts, id])

  useEffect(() => {
    const draft = drafts?.get(id)

    if (draft && debouncedOnChange) {
      draft.claimed = true
      debouncedOnChange(draft.text)
    }

    return () => {
      debouncedOnChange?.cancel()

      const pending = drafts?.get(id)

      if (!pending) {
        return
      }

      // A fullscreen remount mounts the next filter in this same commit, before the microtask runs.
      pending.claimed = false
      queueMicrotask(() => {
        if (!pending.claimed && drafts?.get(id) === pending) {
          drafts.delete(id)
        }
      })
    }
  }, [debouncedOnChange, drafts, id])

  useEffect(() => {
    // The echo of our own emit can land after the user typed on (a consumer that applies the
    // filter in a transition). Resyncing to it would erase those keystrokes and cancel their
    // pending emit, so only a value set from outside replaces the field.
    if (value === lastEmittedRef.current) {
      return
    }

    lastEmittedRef.current = value
    setLocalValue(value)
    debouncedOnChange?.cancel()
    drafts?.delete(id)
  }, [value, debouncedOnChange, drafts, id])

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value

    setLocalValue(nextValue)

    if (debouncedOnChange) {
      drafts?.set(id, { text: nextValue, claimed: true })
      debouncedOnChange(nextValue)
    } else {
      lastEmittedRef.current = nextValue
      onChange(nextValue)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="text"
        name={name}
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder ?? T.searchPlaceholder}
        className={cn(FIELD_CLASS, 'h-10 pl-9')}
        aria-label={ariaLabel ?? placeholder ?? T.searchPlaceholder}
      />
    </div>
  )
}

/** Copied literally from apps/backoffice/ui catalog2-styles.ts CATALOG2_FIELD_CLASS. */
const FIELD_CLASS = 'border-input bg-white shadow-xs'

const T = {
  searchPlaceholder: 'Search…',
} as const
