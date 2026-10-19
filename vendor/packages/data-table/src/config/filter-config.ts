import type { ReactNode } from 'react'

export interface FilterOption {
  value: string
  label: string
}

/** Fields every filter kind carries. `id` keys the control and its label. */
interface FilterBase {
  id: string
  label?: string
  className?: string
}

/** Free-text box. `debounceMs` throttles `onChange`; omit it to fire on every keystroke. */
export interface SearchFilterConfig extends FilterBase {
  kind: 'search'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  debounceMs?: number
  /** Forwarded to the input's `name` attribute. */
  name?: string
  /** Accessible name for the input; falls back to the placeholder. */
  ariaLabel?: string
}

export interface SelectFilterConfig extends FilterBase {
  kind: 'select'
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  placeholder?: string
  allowClear?: boolean
}

/**
 * Searchable combobox with chips.
 *
 * `allowCreate` lets the user add a value that is not in `options`; `createValidator` returns an
 * error message for a rejected input, or null when the input is acceptable.
 */
export interface MultiselectFilterConfig extends FilterBase {
  kind: 'multiselect'
  values: string[]
  onChange: (values: string[]) => void
  options: FilterOption[]
  placeholder?: string
  allowCreate?: boolean
  createValidator?: (input: string) => string | null
  searchable?: boolean
}

/**
 * Calendar that collects a set of individual days as `yyyy-MM-dd` strings.
 * `availableDates` gates which days are selectable; omit it to allow any day.
 */
export interface MultiDateFilterConfig extends FilterBase {
  kind: 'multi-date'
  values: string[]
  onChange: (values: string[]) => void
  availableDates?: string[]
  dateFormat?: string
  placeholder?: string
}

export interface DateRangeValue {
  from?: string
  to?: string
}

export interface DateRangeFilterConfig extends FilterBase {
  kind: 'date-range'
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  placeholder?: string
}

export interface NumberRangeValue {
  min: number
  max: number
}

/** Two-handle slider. `bounds` are the track's extremes, `value` the current selection. */
export interface NumberRangeFilterConfig extends FilterBase {
  kind: 'number-range'
  value: NumberRangeValue
  onChange: (value: NumberRangeValue) => void
  bounds: NumberRangeValue
  step?: number
  unitSymbol?: string
}

/** Reset control. Clearing is the consumer's job — the filter bar owns no state. */
export interface ClearAllFilterConfig {
  kind: 'clear-all'
  id: string
  onClear: () => void
  label?: string
  className?: string
}

export interface CustomFilterConfig {
  kind: 'custom'
  id: string
  render: () => ReactNode
  className?: string
}

export type FilterConfig =
  | ClearAllFilterConfig
  | CustomFilterConfig
  | DateRangeFilterConfig
  | MultiDateFilterConfig
  | MultiselectFilterConfig
  | NumberRangeFilterConfig
  | SearchFilterConfig
  | SelectFilterConfig

/** Discriminants of every built-in filter kind. */
export type FilterKind = FilterConfig['kind']
