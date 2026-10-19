import { matchSorter } from 'match-sorter'

import type { MultiselectFilterConfig } from '../config/filter-config'
import type { MultiSelectComboboxOption } from './multi-select-combobox'
import { MultiSelectCombobox } from './multi-select-combobox'

export interface MultiselectFilterProps {
  config: MultiselectFilterConfig
}

/**
 * Bare control for `MultiselectFilterConfig` — the filter bar supplies the label. Built on
 * `MultiSelectCombobox` with match-sorter fuzzy search (mirrors catalog2-multi-select-filter's
 * search UX) unless `searchable` is explicitly disabled, which falls back to substring matching.
 */
export const MultiselectFilter = (props: MultiselectFilterProps) => {
  const { config } = props

  const { values, onChange, options, placeholder, allowCreate, createValidator, searchable, className } = config

  return (
    <MultiSelectCombobox
      className={className}
      value={values}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      allowCreate={allowCreate}
      validateCreate={createValidator}
      showSelectAll
      searchOptions={searchable === false ? undefined : matchSorterSearch}
    />
  )
}

const matchSorterSearch = (options: MultiSelectComboboxOption[], query: string): MultiSelectComboboxOption[] => {
  const trimmed = query.trim()

  if (trimmed.length === 0) {
    return options
  }

  return matchSorter(options, trimmed, { keys: ['value', 'label'] })
}
