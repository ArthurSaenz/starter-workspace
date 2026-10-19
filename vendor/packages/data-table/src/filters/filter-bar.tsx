import type { ComponentType } from 'react'
import { Fragment } from 'react'

import type {
  ClearAllFilterConfig,
  DateRangeFilterConfig,
  FilterConfig,
  MultiDateFilterConfig,
  MultiselectFilterConfig,
  NumberRangeFilterConfig,
  SearchFilterConfig,
  SelectFilterConfig,
} from '../config/filter-config'
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

        switch (config.kind) {
          case 'search': {
            const Component = resolvedRegistry.search

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          case 'select': {
            const Component = resolvedRegistry.select

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          case 'multiselect': {
            const Component = resolvedRegistry.multiselect

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          case 'multi-date': {
            const Component = resolvedRegistry['multi-date']

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          case 'date-range': {
            const Component = resolvedRegistry['date-range']

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          case 'number-range': {
            const Component = resolvedRegistry['number-range']

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          case 'clear-all': {
            const Component = resolvedRegistry['clear-all']

            return (
              <FilterField key={config.id} label={config.label} className={config.className}>
                <Component config={config} />
              </FilterField>
            )
          }
          default: {
            return null
          }
        }
      })}
    </div>
  )
}

/**
 * Structural registry type, local to this package until Phase 8 reconciles it with the core
 * registry type living in `src/core`. Maps every non-custom `FilterKind` to the component that
 * renders it; `custom` always renders `config.render()` directly and has no registry entry.
 */
export interface FilterRegistry {
  search: ComponentType<{ config: SearchFilterConfig }>
  select: ComponentType<{ config: SelectFilterConfig }>
  multiselect: ComponentType<{ config: MultiselectFilterConfig }>
  'multi-date': ComponentType<{ config: MultiDateFilterConfig }>
  'date-range': ComponentType<{ config: DateRangeFilterConfig }>
  'number-range': ComponentType<{ config: NumberRangeFilterConfig }>
  'clear-all': ComponentType<{ config: ClearAllFilterConfig }>
}

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
