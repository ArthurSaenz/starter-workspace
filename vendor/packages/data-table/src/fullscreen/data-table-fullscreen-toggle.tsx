// Ported from the backoffice's former components/ui/data-table/data-table-fullscreen-toggle.tsx,
// swapping the app's Button/cn imports for the package's own primitives. Labels kept verbatim.
import { Maximize2, Minimize2 } from 'lucide-react'

import { Button } from '../primitives/button'
import { cn } from '../primitives/cn'

export interface DataTableFullscreenToggleProps {
  isFullscreen: boolean
  onToggle: () => void
  className?: string
}

export const DataTableFullscreenToggle = (props: DataTableFullscreenToggleProps) => {
  const { isFullscreen, onToggle, className } = props

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('h-8', className)}
      onClick={onToggle}
      aria-label={isFullscreen ? T.exitFullscreen : T.enterFullscreen}
      aria-pressed={isFullscreen}
    >
      {isFullscreen ? <Minimize2 /> : <Maximize2 />}
      {isFullscreen ? T.exitFullscreen : T.enterFullscreen}
    </Button>
  )
}

const T = {
  enterFullscreen: 'Enter fullscreen',
  exitFullscreen: 'Exit fullscreen',
} as const
