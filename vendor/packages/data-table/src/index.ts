// Public surface of `@wl/data-table`. This barrel — not any individual module file — is the
// package's breaking-change boundary (see the `exports` map in package.json and this package's
// CLAUDE.md). Every module under src/ that is not re-exported here is a private implementation
// detail and may change without notice.

// Cell kind registry
export { createCellRegistry } from './cells/cell-registry'

// Every config type a column/cell/filter/pagination/row-styling schema is written against.
export type * from './config'

// Table shell
export { DataTable } from './core/data-table'
export type { DataTableProps } from './core/data-table'
export { DataTableColumnHeader } from './core/data-table-column-header'
export type { DataTableColumnHeaderProps } from './core/data-table-column-header'
export { DataTableRowCount } from './core/data-table-row-count'
export type { DataTableRowCountProps } from './core/data-table-row-count'
export { DataTableViewOptions } from './core/data-table-view-options'
export type { DataTableViewOptionsProps } from './core/data-table-view-options'

// Filters
export { createFilterRegistry, FilterBar } from './filters/filter-bar'
export type { FilterRegistry } from './filters/filter-bar'
export { FilterField } from './filters/filter-field'
export type { FilterFieldProps } from './filters/filter-field'
export {
  areAllOptionsSelected,
  filterOptions,
  isMultiSelectComboboxListEvent,
  MULTI_SELECT_COMBOBOX_LIST_SLOT,
  MultiSelectCombobox,
  toggleValue,
} from './filters/multi-select-combobox'
export type { MultiSelectComboboxOption, MultiSelectComboboxProps } from './filters/multi-select-combobox'

// Fullscreen
export { DataTableFullscreenPortal } from './fullscreen/data-table-fullscreen-portal'
export type { DataTableFullscreenPortalProps } from './fullscreen/data-table-fullscreen-portal'
export { DataTableFullscreenToggle } from './fullscreen/data-table-fullscreen-toggle'
export type { DataTableFullscreenToggleProps } from './fullscreen/data-table-fullscreen-toggle'
export { useDataTableFullscreen } from './fullscreen/use-data-table-fullscreen'
export type { UseDataTableFullscreenResult } from './fullscreen/use-data-table-fullscreen'

// Pagination
export { DataTablePagination } from './pagination/data-table-pagination'
export type { DataTablePaginationProps } from './pagination/data-table-pagination'
export { ADMIN_PAGE_SIZE_OPTIONS, CATALOG_PAGE_SIZE_OPTIONS } from './pagination/page-size-presets'
export type { AdminPageSize, CatalogPageSize } from './pagination/page-size-presets'

// Shared z-index scale, for consumers that need to stack their own UI above/below the table's
// fullscreen overlay or portaled popovers.
export { DATA_TABLE_FULLSCREEN_Z_INDEX, DATA_TABLE_POPOVER_Z_INDEX } from './primitives/z-index'

// TanStack state types that consumers hold when they control table state, re-exported so apps
// depend on `@wl/data-table` alone and never import `@tanstack/react-table` directly.
export type {
  ColumnVisibilityState,
  ExpandedState,
  OnChangeFn,
  PaginationState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'
