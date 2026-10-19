import { Check, Link2, Pencil, Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import type { ActionsCellConfig, CellRenderContext, RowActionConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { Button } from '../primitives/button'
import { cn } from '../primitives/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

type ActionsCellProps<TData> = CellRendererProps<TData, ActionsCellConfig<TData>>

/**
 * Row action buttons — edit/save/copy-link/custom. `RowActionConfig` carries no data to copy, so
 * (matching `Catalog2ActionsCell`/`Catalog2CopyLinkButton`, where the actual `copyToClipboard`
 * call lives in the consumer's `onCopy` handler, not the button) the actual clipboard write is the
 * consumer's `onClick`; this component only owns the transient checkmark feedback.
 */
export const ActionsCell = <TData,>(props: ActionsCellProps<TData>) => {
  const { config, ctx, row } = props

  return (
    <div className="flex items-center gap-2">
      {config.actions.map((action) => {
        if (action.hidden?.(row)) {
          return null
        }

        return <RowActionButton key={action.id} action={action} ctx={ctx} row={row} />
      })}
    </div>
  )
}

interface RowActionButtonProps<TData> {
  action: RowActionConfig<TData>
  ctx: CellRenderContext<TData>
  row: TData
}

const RowActionButton = <TData,>(props: RowActionButtonProps<TData>) => {
  const { action, ctx, row } = props

  const [justCopied, setJustCopied] = useState(false)

  useEffect(() => {
    if (!justCopied) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setJustCopied(false)
    }, COPY_FEEDBACK_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [justCopied])

  const isDisabled = action.disabled?.(row) ?? false

  let icon: ReactNode = action.icon ?? null

  if (action.kind === 'edit' || action.kind === 'save') {
    icon = FIXED_ACTION_ICONS[action.kind]
  } else if (action.kind === 'copy-link') {
    icon = justCopied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />
  }

  const handleClick = () => {
    action.onClick(ctx)

    if (action.kind === 'copy-link') {
      setJustCopied(true)
    }
  }

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', action.className)}
      aria-label={action.label}
      disabled={isDisabled}
      onClick={handleClick}
    >
      {icon}
    </Button>
  )

  if (!action.tooltip) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{action.tooltip}</TooltipContent>
    </Tooltip>
  )
}

/** Fixed icons for the two non-copy, non-custom kinds — matches `Catalog2ActionsCell`'s Save icon and the app's Pencil "edit full info" action. */
const FIXED_ACTION_ICONS: Record<'edit' | 'save', ReactNode> = {
  edit: <Pencil className="h-4 w-4" />,
  save: <Save className="h-4 w-4" />,
}

/** How long the copy-link button shows its checkmark before reverting — long enough to register, short enough not to feel stuck. */
const COPY_FEEDBACK_MS = 1500
