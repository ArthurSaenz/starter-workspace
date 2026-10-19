import type { ExpandedState, OnChangeFn } from '@tanstack/react-table'
import type { ReactNode } from 'react'

import type { CellRenderContext } from './cell-config'

/**
 * Sub-row panel rendered under an expanded row.
 *
 * Every catalog renders a bespoke panel, so `custom` is the only kind; the discriminant is kept
 * so further kinds can be added without breaking existing configs.
 *
 * Leave `expanded`/`onExpandedChange` out to let the table own expansion; pass both to control
 * it (the containers that keep expansion in Jotai).
 */
export interface ExpandableConfig<TData> {
  kind: 'custom'
  render: (ctx: CellRenderContext<TData>) => ReactNode
  canExpand?: (row: TData) => boolean
  expanded?: ExpandedState
  onExpandedChange?: OnChangeFn<ExpandedState>
  subRowClassName?: string
}
