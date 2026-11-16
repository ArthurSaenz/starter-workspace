// Public surface of `@wl/data-table`. This barrel — not any individual module file — is the
// package's breaking-change boundary (see the `exports` map in package.json and this package's
// CLAUDE.md). Every module under src/ that is not re-exported here is a private implementation
// detail and may change without notice.

// Cell kind registry
export { createCellRegistry } from './cells'

// Every config type a column/cell/filter/pagination/row-styling schema is written against.
export type * from './config'

// Table shell
export { DataTable } from './core'
export type { DataTableProps } from './core'
export { DataTableColumnHeader } from './core'
export type { DataTableColumnHeaderProps } from './core'
export { DataTableRowCount } from './core'
export type { DataTableRowCountProps } from './core'
export { DataTableViewOptions } from './core'
export type { DataTableViewOptionsProps } from './core'

// Filters
export { createFilterRegistry, FilterBar } from './filters'
export type { FilterRegistry } from './filters'
export { FilterField } from './filters'
export type { FilterFieldProps } from './filters'
export {
  areAllOptionsSelected,
  filterOptions,
  isMultiSelectComboboxListEvent,
  MULTI_SELECT_COMBOBOX_LIST_SLOT,
  MultiSelectCombobox,
  toggleValue,
} from './filters'
export type { MultiSelectComboboxOption, MultiSelectComboboxProps } from './filters'

// Fullscreen
export { DataTableFullscreenPortal } from './fullscreen'
export type { DataTableFullscreenPortalProps } from './fullscreen'
export { DataTableFullscreenToggle } from './fullscreen'
export type { DataTableFullscreenToggleProps } from './fullscreen'
export { useDataTableFullscreen } from './fullscreen'
export type { UseDataTableFullscreenResult } from './fullscreen'

// Pagination
export { DataTablePagination } from './pagination'
export type { DataTablePaginationProps } from './pagination'
export { ADMIN_PAGE_SIZE_OPTIONS, CATALOG_PAGE_SIZE_OPTIONS } from './pagination'
export type { AdminPageSize, CatalogPageSize } from './pagination'

// Shared z-index scale, for consumers that need to stack their own UI above/below the table's
// fullscreen overlay or portaled popovers.
export { DATA_TABLE_FULLSCREEN_Z_INDEX, DATA_TABLE_POPOVER_Z_INDEX } from './primitives'

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
