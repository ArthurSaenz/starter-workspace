import type { KeyboardEvent } from 'react'

import type { MultiSelectComboboxOption } from './types'

interface CreateKeyDownHandlerArgs {
  disabled?: boolean
  isOpen: boolean
  query: string
  value: string[]
  filteredOptions: MultiSelectComboboxOption[]
  closeOnSelect?: boolean
  setOpen: (open: boolean) => void
  setQuery: (query: string) => void
  commitToggle: (value: string) => void
  commitCreate: () => void
}

export const createKeyDownHandler = (args: CreateKeyDownHandlerArgs) => {
  const {
    disabled,
    isOpen,
    query,
    value,
    filteredOptions,
    closeOnSelect,
    setOpen,
    setQuery,
    commitToggle,
    commitCreate,
  } = args

  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      return
    }

    if (event.key === 'Escape') {
      if (isOpen) {
        // Marks the press as consumed, as a Radix layer does, so the enclosing fullscreen view
        // stays open.
        event.preventDefault()
      }

      setOpen(false)

      return
    }

    if (event.key === 'Backspace' && query === '' && value.length > 0) {
      commitToggle(value[value.length - 1] as string)

      return
    }

    // A closed list shows nothing to pick, so Enter there would toggle an option the user cannot
    // see — after a `closeOnSelect` pick, the very option just chosen.
    if (event.key !== 'Enter' || !isOpen) {
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
