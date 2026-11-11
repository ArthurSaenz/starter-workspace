import {
  disablePageScroll as _disablePageScroll,
  enablePageScroll as _enablePageScroll,
  markScrollable,
  unmarkScrollable,
} from '@fluejs/noscroll'
import { useEffect } from 'react'

const SCROLLABLE_SELECTOR = '[data-noscroll-scrollable]'

const markScrollableElements = () => {
  for (const el of document.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR)) {
    markScrollable(el)
  }
}

const unmarkScrollableElements = () => {
  for (const el of document.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR)) {
    unmarkScrollable(el)
  }
}

export const disablePageScroll = () => {
  markScrollableElements()
  _disablePageScroll()
}

export const enablePageScroll = () => {
  unmarkScrollableElements()
  _enablePageScroll()
}

interface Options {
  locked?: boolean
}

/**
 * Locks or unlocks the body scroll for a given element.
 *
 * @example
 *     const ref = useRef<HTMLElement>(null)
 *     useBodyScrollLock(ref, { locked: true })
 */
export const useBodyScrollLock = (
  scrollLockTarget: React.RefObject<HTMLElement | null>,
  options: Options = {},
): void => {
  const { locked = true } = options

  useEffect(() => {
    const element = scrollLockTarget.current

    // The page lock is reference-counted: only a hook that took a lock may release one.
    if (!element || !locked) {
      return
    }

    markScrollable(element)
    disablePageScroll()

    return (): void => {
      unmarkScrollable(element)
      enablePageScroll()
    }
  }, [scrollLockTarget.current, locked])
}
