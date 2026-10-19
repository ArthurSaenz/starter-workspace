// Ported from the backoffice's former components/ui/data-table/use-data-table-fullscreen.ts,
// byte-identical: the hook has no app-specific dependency.
import { useCallback, useEffect, useState } from 'react'

export interface UseDataTableFullscreenResult {
  isFullscreen: boolean
  toggleFullscreen: () => void
  exitFullscreen: () => void
}

export const useDataTableFullscreen = (): UseDataTableFullscreenResult => {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false)
  }, [])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((current) => {
      return !current
    })
  }, [])

  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitFullscreen()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullscreen, exitFullscreen])

  return {
    isFullscreen,
    toggleFullscreen,
    exitFullscreen,
  }
}
