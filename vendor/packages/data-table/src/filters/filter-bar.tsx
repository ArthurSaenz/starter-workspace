import type { ComponentType } from 'react'
import { Fragment } from 'react'

import type { FilterConfig, FilterKind } from '../config/filter-config'
import type { FilterConfigOfKind } from '../core/cell-renderer-types'
import { cn } from '../primitives/cn'
import { ClearAllFilter } from './clear-all-filter'
import { DateRangeFilter } from './date-range-filter'
import { FilterField } from './filter-field'
import { MultiDateFilter } from './multi-date-filter'
import { MultiselectFilter } from './multiselect-filter'
import { NumberRangeFilter } from './number-range-filter'
import { SearchFilter } from './search-filter'
import { SelectFilter } from './select-filter'

export interface FilterBarProps {
  filters: FilterConfig[]
  registry?: Partial<FilterRegistry>
  className?: string
}

/** Renders `filters` in order, wrapping each non-custom kind in a `FilterField` labeled from its config. */
export const FilterBar = (props: FilterBarProps) => {
  const { filters, registry, className } = props

  const resolvedRegistry = createFilterRegistry(registry)

  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)}>
      {filters.map((config) => {
        if (config.kind === 'custom') {
          return <Fragment key={config.id}>{config.render()}</Fragment>
        }

        // The key comes from the config being rendered, so the entry accepts that config; TypeScript
        // cannot correlate the two across the union (same cast as `resolveCellRenderer`).
        const Component = resolvedRegistry[config.kind] as ComponentType<{ config: RegisteredFilterConfig }>

        return (
          <FilterField
            key={config.id}
            label={config.label}
            // The clear-all button already shows its label; the field only reserves the label row.
            hideLabel={config.kind === 'clear-all'}
            className={config.className}
          >
            <Component config={config} />
          </FilterField>
        )
      })}
    </div>
  )
}

/**
 * Maps every non-custom `FilterKind` to the component that renders it; `custom` always renders
 * `config.render()` directly and has no registry entry. A new kind needs only its entry in
 * `DEFAULT_FILTER_REGISTRY`, which this mapped type makes a compile error to forget.
 */
export type FilterRegistry = {
  [TKind in RegisteredFilterKind]: ComponentType<{ config: FilterConfigOfKind<TKind> }>
}

type RegisteredFilterKind = Exclude<FilterKind, 'custom'>

type RegisteredFilterConfig = FilterConfigOfKind<RegisteredFilterKind>

const DEFAULT_FILTER_REGISTRY: FilterRegistry = {
  search: SearchFilter,
  select: SelectFilter,
  multiselect: MultiselectFilter,
  'multi-date': MultiDateFilter,
  'date-range': DateRangeFilter,
  'number-range': NumberRangeFilter,
  'clear-all': ClearAllFilter,
}

/** Merges `extra` overrides onto the default registry so consumers can replace individual kinds. */
export const createFilterRegistry = (extra?: Partial<FilterRegistry>): FilterRegistry => {
  return { ...DEFAULT_FILTER_REGISTRY, ...extra }
}
