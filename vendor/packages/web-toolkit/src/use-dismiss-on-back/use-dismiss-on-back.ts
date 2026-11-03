import { useEffect, useEffectEvent, useRef } from 'react'

import { pushDismissLayer } from './dismiss-stack'

/**
 * - `back-button` — the native back (Android button/gesture, via `dismissTopLayer`) closed the layer instead of navigating.
 * - `navigation` — the location moved while the layer was open (iOS edge swipe, browser back), so it must not follow the user to the next page.
 */
export type BackDismissTrigger = 'back-button' | 'navigation'

interface UseDismissOnBackArgs {
  isOpen: boolean
  onDismiss: (trigger: BackDismissTrigger) => void
  /** Any string that changes with the current location, e.g. pathname + search from the app's router. */
  locationKey: string
}

/**
 * @description - Makes an overlay (menu, drawer, modal) close on "back" the way native apps do.
 */
export const useDismissOnBack = (args: UseDismissOnBackArgs) => {
  const { isOpen, onDismiss, locationKey } = args

  // An overlay opened by a URL change records the new location, so it does not close itself.
  const openedAtLocationRef = useRef<string | null>(null)

  const handleDismiss = useEffectEvent(onDismiss)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    return pushDismissLayer(() => {
      handleDismiss('back-button')
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      openedAtLocationRef.current = null

      return
    }

    if (openedAtLocationRef.current === null) {
      openedAtLocationRef.current = locationKey

      return
    }

    if (openedAtLocationRef.current !== locationKey) {
      handleDismiss('navigation')
    }
  }, [isOpen, locationKey])
}
