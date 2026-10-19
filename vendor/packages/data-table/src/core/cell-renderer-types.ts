import type { ComponentType } from 'react'

import type { CellConfig, CellKind, CellRenderContext, FilterConfig, FilterKind } from '../config'

/**
 * What every cell renderer receives.
 *
 * `row` is the same object as `ctx.row`; it is passed separately because almost every renderer
 * needs it and destructuring one property reads better than reaching through the context.
 */
export interface CellRendererProps<TData, TConfig> {
  config: TConfig
  ctx: CellRenderContext<TData>
  row: TData
}

/**
 * A cell renderer is a React component, not a render function: the column defs hand its identity
 * to `flexRender`, which turns it into an element type. A component whose identity is stable
 * across renders keeps its DOM — that is what lets an input inside a cell hold focus while the
 * consumer rebuilds its config object on every keystroke.
 */
export type CellRenderer<TData, TConfig = CellConfig<TData>> = ComponentType<CellRendererProps<TData, TConfig>>

/** Narrows the cell union to the single member a given `kind` discriminant selects. */
export type CellConfigOfKind<TData, TKind extends CellKind> = Extract<CellConfig<TData>, { kind: TKind }>

/**
 * kind → renderer. Partial so a consumer can ship a registry covering only the kinds its configs
 * use; `buildColumnDefs` renders an explicit error cell for a kind with no entry.
 */
export type CellRegistry<TData> = {
  [TKind in CellKind]?: CellRenderer<TData, CellConfigOfKind<TData, TKind>>
}

/** What every filter renderer receives. Filters own no row, so they get their config alone. */
export interface FilterRendererProps<TConfig> {
  config: TConfig
}

export type FilterRenderer<TConfig = FilterConfig> = ComponentType<FilterRendererProps<TConfig>>

/** Narrows the filter union to the single member a given `kind` discriminant selects. */
export type FilterConfigOfKind<TKind extends FilterKind> = Extract<FilterConfig, { kind: TKind }>

/** kind → renderer, the filter-bar counterpart of {@link CellRegistry}. */
export type FilterRegistry = {
  [TKind in FilterKind]?: FilterRenderer<FilterConfigOfKind<TKind>>
}
