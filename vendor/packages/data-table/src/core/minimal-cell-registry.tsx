import { ChevronDown } from 'lucide-react'

import type { CustomCellConfig, ExpanderCellConfig, TextCellConfig } from '../config'
import { cn } from '../primitives/cn'
import type { CellRegistry, CellRendererProps } from './cell-renderer-types'

/**
 * Renderers for the three kinds the table shell itself needs: a value to print, an escape hatch,
 * and the expand chevron. Everything else (prices, switches, actions…) lands in the full registry
 * that ships with the cells phase; this one exists so the shell can be built and tested without
 * depending on it, and so `DataTable` has a usable default when no registry is passed.
 */
type TextCellProps<TData> = CellRendererProps<TData, TextCellConfig<TData>>

const TextCell = <TData,>(props: TextCellProps<TData>) => {
  const { config, row } = props

  const value = config.value(row)
  const className = typeof config.className === 'function' ? config.className(row) : config.className

  return <span className={cn(className)}>{value ?? ''}</span>
}

type CustomCellProps<TData> = CellRendererProps<TData, CustomCellConfig<TData>>

const CustomCell = <TData,>(props: CustomCellProps<TData>) => {
  const { config, ctx } = props

  return <>{config.render(ctx)}</>
}

type ExpanderCellProps<TData> = CellRendererProps<TData, ExpanderCellConfig>

/** Mirrors `FlightsCatalogExpandCell` — a chevron that rotates 180° once the row is open. */
const ExpanderCell = <TData,>(props: ExpanderCellProps<TData>) => {
  const { ctx } = props

  const handleToggleClick = () => {
    ctx.toggleExpanded()
  }

  return (
    <button
      type="button"
      onClick={handleToggleClick}
      className="cursor-pointer p-1"
      aria-expanded={ctx.isExpanded}
      aria-label={T.toggleExpand}
    >
      <ChevronDown
        className={cn('h-6 w-6 transition-transform', ctx.isExpanded ? 'rotate-180' : 'rotate-0')}
        aria-hidden
      />
    </button>
  )
}

export const createMinimalCellRegistry = <TData,>(): CellRegistry<TData> => {
  return {
    text: TextCell,
    custom: CustomCell,
    expander: ExpanderCell,
  }
}

/**
 * The default registry `DataTable` falls back to.
 *
 * Built once at module load on purpose: `flexRender` turns each renderer into a React element
 * type, so a registry rebuilt per render would remount every cell and drop focus mid-typing.
 */
export const MINIMAL_CELL_REGISTRY: CellRegistry<never> = createMinimalCellRegistry<never>()

const T = {
  toggleExpand: 'Toggle row details',
} as const
