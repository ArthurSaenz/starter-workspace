import { useEffect, useEffectEvent } from 'react'

import { pushDismissLayer } from './dismiss-stack'

/**
 * - `back-button` — the native back (Android button/gesture, via `dismissTopLayer`) closed the layer instead of navigating.
 * - `navigation` — the user traversed history while the layer was open (browser back/forward, iOS edge swipe).
 *   A layer that lives above the pages (a menu) closes on it; a layer inside a page unmounts with that page and can ignore it.
 */
export type BackDismissTrigger = 'back-button' | 'navigation'

interface UseDismissOnBackArgs {
  isOpen: boolean
  onDismiss: (trigger: BackDismissTrigger) => void
}

/**
 * @description - Makes an overlay (menu, drawer, modal) close on "back" the way native apps do.
 */
export const useDismissOnBack = (args: UseDismissOnBackArgs) => {
  const { isOpen, onDismiss } = args

  const handleDismiss = useEffectEvent(onDismiss)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const removeLayer = pushDismissLayer(() => {
      handleDismiss('back-button')
    })

    // `popstate` fires only on a history traversal. The app's own push/replace does not, so an overlay that writes
    // its state to the URL while open (a modal's search param) is not mistaken for the user leaving.
    const handlePopState = () => {
      handleDismiss('navigation')
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      removeLayer()
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isOpen])
}
