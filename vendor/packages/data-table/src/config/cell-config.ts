import type { ReactNode } from 'react'

/**
 * Everything a cell renderer knows about the row it is drawing. Passed to the `custom` escape
 * hatch and to row actions so a consumer never has to reach for the underlying TanStack row.
 */
export interface CellRenderContext<TData> {
  row: TData
  rowIndex: number
  isExpanded: boolean
  toggleExpanded: () => void
  columnId: string
}

/** What a value getter may hand back for rendering; nullish renders as empty. */
export type CellValue = string | number | null | undefined

/** A class string, or one derived per row (profit below threshold turns red, etc.). */
export type CellClassName<TData> = string | ((row: TData) => string | undefined)

/** A flag that is either fixed for the column or decided per row. */
export type CellFlag<TData> = boolean | ((row: TData) => boolean)

/** Text adornment rendered before/after a computed value, fixed or derived per row. */
export type CellAdornment<TData> = string | ((row: TData) => string | undefined)

/** Read-only value rendered as plain text. */
export interface TextCellConfig<TData> {
  kind: 'text'
  value: (row: TData) => CellValue
  className?: CellClassName<TData>
}

/** Variants of the vendored shadcn Badge primitive. */
export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export interface BadgeCellConfig<TData> {
  kind: 'badge'
  value: (row: TData) => CellValue
  variant?: BadgeVariant | ((row: TData) => BadgeVariant)
  className?: CellClassName<TData>
}

/**
 * One editable numeric field inside a `price-input` or `number-input` cell.
 *
 * `value` may return null/undefined: the catalogs store prices per passenger type and an absent
 * passenger renders as an empty input rather than `0`.
 *
 * `idAttribute` picks which DOM attribute `id` is written to. The flights/packages catalogs
 * address their inputs by `id` (`${dealId}-adult-buyingPrice`); forms that submit natively want
 * `name` instead.
 *
 * `id` is the field's stable identity inside the cell and the value written to that attribute.
 * A catalog whose inputs are addressed per row (`${dealId}-adult-buyingPrice`) derives the
 * attribute from the row with `domId`; `id` still keys the field.
 */
export interface PriceFieldConfig<TData> {
  id: string
  domId?: (row: TData) => string
  label?: string
  value: (row: TData) => CellValue
  onChange: (args: { row: TData; value: string }) => void
  onBlur?: (args: { row: TData; value: string }) => void
  className?: string
  inputClassName?: string
  idAttribute?: 'id' | 'name'
  disabled?: CellFlag<TData>
  placeholder?: string
}

export interface CurrencyOption {
  value: string
  label: string
}

/** The currency `<Select>` that sits under a price cell's inputs. */
export interface CurrencySelectConfig<TData> {
  value: (row: TData) => string
  onChange: (args: { row: TData; value: string }) => void
  options: CurrencyOption[]
  triggerSize?: 'sm' | 'default'
  triggerClassName?: string
}

/**
 * Multi-field money editor: N numeric inputs stacked in one cell plus an optional currency
 * select — the shape the flights/packages buying and selling columns actually need.
 */
export interface PriceInputCellConfig<TData> {
  kind: 'price-input'
  fields: PriceFieldConfig<TData>[]
  currency?: CurrencySelectConfig<TData>
  wrapperClassName?: string
}

/** Standalone currency select, for columns that edit a currency without prices next to it. */
export interface CurrencySelectCellConfig<TData> extends CurrencySelectConfig<TData> {
  kind: 'currency-select'
  className?: string
}

/** Single-field variant of `price-input`. */
export interface NumberInputCellConfig<TData> {
  kind: 'number-input'
  field: PriceFieldConfig<TData>
  wrapperClassName?: string
}

/** Free-text editor. `slot` renders under the textarea (the catalogs put comment pills there). */
export interface TextareaCellConfig<TData> {
  kind: 'textarea'
  value: (row: TData) => string
  onChange: (args: { row: TData; value: string }) => void
  placeholder?: string
  className?: string
  slot?: (row: TData) => ReactNode
}

export interface SwitchCellConfig<TData> {
  kind: 'switch'
  checked: (row: TData) => boolean
  onToggle: (args: { row: TData; checked: boolean }) => void
  className?: string
  disabled?: CellFlag<TData>
}

/** Read-only derived value with optional adornments — profit percentages, computed totals. */
export interface ComputedCellConfig<TData> {
  kind: 'computed'
  value: (row: TData) => CellValue
  className?: CellClassName<TData>
  prefix?: CellAdornment<TData>
  suffix?: CellAdornment<TData>
}

/** `kind` selects the built-in icon/styling; `custom` means the consumer supplies `icon`. */
export type RowActionKind = 'edit' | 'save' | 'copy-link' | 'custom'

export interface RowActionConfig<TData> {
  id: string
  kind?: RowActionKind
  label: string
  icon?: ReactNode
  onClick: (ctx: CellRenderContext<TData>) => void
  hidden?: (row: TData) => boolean
  disabled?: (row: TData) => boolean
  tooltip?: string
  className?: string
}

export interface ActionsCellConfig<TData> {
  kind: 'actions'
  actions: RowActionConfig<TData>[]
}

/** Expand/collapse chevron. Reads `isExpanded`/`toggleExpanded` off the render context. */
export interface ExpanderCellConfig {
  kind: 'expander'
}

/**
 * Controlled row selection: the consumer owns the selected set (the shows catalog keeps a
 * `Set<string>` of deal ids), so this deliberately does not use TanStack's `RowSelectionState`.
 */
export interface CheckboxSelectCellConfig<TData> {
  kind: 'checkbox-select'
  isSelected: (row: TData) => boolean
  onToggle: (row: TData) => void
  disabled?: (row: TData) => boolean
  /** Accessible name per row, for tables whose checkbox has no visible header text. */
  ariaLabel?: (row: TData) => string
  className?: string
}

/** Escape hatch for cells no registry kind covers (hotel price popover, shows field grid). */
export interface CustomCellConfig<TData> {
  kind: 'custom'
  render: (ctx: CellRenderContext<TData>) => ReactNode
}

export type CellConfig<TData> =
  | ActionsCellConfig<TData>
  | BadgeCellConfig<TData>
  | CheckboxSelectCellConfig<TData>
  | ComputedCellConfig<TData>
  | CurrencySelectCellConfig<TData>
  | CustomCellConfig<TData>
  | ExpanderCellConfig
  | NumberInputCellConfig<TData>
  | PriceInputCellConfig<TData>
  | SwitchCellConfig<TData>
  | TextCellConfig<TData>
  | TextareaCellConfig<TData>

/** Discriminants of every built-in cell kind. */
export type CellKind = CellConfig<never>['kind']
