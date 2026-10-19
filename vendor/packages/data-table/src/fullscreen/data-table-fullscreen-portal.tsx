// Ported from the backoffice's former components/ui/data-table/data-table-fullscreen-portal.tsx.
// The app lifts stacking with its own `zIndex.dataTableFullscreen` Tailwind class; the package
// cannot reach that scale, so it applies `DATA_TABLE_FULLSCREEN_Z_INDEX` as an inline style by
// default and lets `zIndexClassName` (config.fullscreen.zIndexClassName) replace it outright.
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '../primitives/button'
import { cn } from '../primitives/cn'
import { DATA_TABLE_FULLSCREEN_Z_INDEX } from '../primitives/z-index'

export interface DataTableFullscreenPortalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  toolbar?: ReactNode
  children: ReactNode
  zIndexClassName?: string
}

export const DataTableFullscreenPortal = (props: DataTableFullscreenPortalProps) => {
  const { isOpen, title, onClose, toolbar, children, zIndexClassName } = props

  if (!isOpen) {
    return null
  }

  return createPortal(
    <div
      className={cn('bg-background fixed inset-0 flex flex-col gap-4 p-6', zIndexClassName)}
      style={zIndexClassName ? undefined : { zIndex: DATA_TABLE_FULLSCREEN_Z_INDEX }}
      role="dialog"
      aria-modal
      aria-label={title}
    >
      <div className="flex shrink-0 items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {toolbar}
          <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={onClose} aria-label={T.close}>
            <X />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
    </div>,
    document.body,
  )
}

const T = {
  close: 'Close',
} as const
