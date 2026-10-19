import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from './cn'
import { DATA_TABLE_POPOVER_Z_INDEX } from './z-index'

const TooltipProvider = (props: React.ComponentProps<typeof TooltipPrimitive.Provider>) => {
  const { delayDuration = 0, ...rest } = props

  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...rest} />
}

const Tooltip = (props: React.ComponentProps<typeof TooltipPrimitive.Root>) => {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

const TooltipTrigger = (props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) => {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

const TooltipContent = (props: React.ComponentProps<typeof TooltipPrimitive.Content>) => {
  const { className, style, sideOffset = 0, children, ...rest } = props

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        style={{ zIndex: DATA_TABLE_POPOVER_Z_INDEX, ...style }}
        {...rest}
      >
        {children}
        <TooltipPrimitive.Arrow
          className={cn(
            'bg-foreground fill-foreground size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]',
          )}
          style={{ zIndex: DATA_TABLE_POPOVER_Z_INDEX }}
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
