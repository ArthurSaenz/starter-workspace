import throttle from 'lodash/throttle'
import type { RefObject } from 'react'
import { useEffect } from 'react'

interface UseStickyProps {
  scrollRef?: RefObject<HTMLElement | null>
}

/**
 * This is a custom hook for sticky component.
 *
 * @example
 *     useScrollKeyboard({ scrollRef: scrollRef })
 */
export const useScrollKeyboard = ({ scrollRef }: UseStickyProps) => {
  useEffect(() => {
    // Captured now: React has already cleared the ref by the time an unmount cleanup runs.
    const scrollElement = scrollRef?.current

    if (scrollElement) {
      const inputElement = document.querySelector<HTMLInputElement>('[data-mobile-input="true"]')
      let frameId: number | undefined

      const handleScroll = () => {
        frameId = requestAnimationFrame(() => {
          if (inputElement && document.activeElement === inputElement) {
            inputElement.blur()
          }
        })
      }

      const throttledFn = throttle(handleScroll, 50)

      scrollElement.addEventListener('scroll', throttledFn)

      return () => {
        scrollElement.removeEventListener('scroll', throttledFn)
        throttledFn.cancel()

        if (frameId !== undefined) cancelAnimationFrame(frameId)
      }
    }
  }, [])
}
