import type { MultiSelectComboboxOption } from './types'

export const buildExternalKey = (valueKey: string, options: MultiSelectComboboxOption[]): string => {
  return `${valueKey}|${options
    .map((option) => {
      return option.value
    })
    .join('\u0001')}`
}

export const buildLabelByValue = (options: MultiSelectComboboxOption[]): Map<string, string> => {
  return new Map(
    options.map((option) => {
      return [option.value, option.label]
    }),
  )
}

export const resolveCreateError = (
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

export const canCreateValue = (args: CanCreateValueArgs): boolean => {
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
