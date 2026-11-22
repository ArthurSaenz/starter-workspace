import { useEffect } from 'react'

const ADD_MENU_BUTTON = '[data-testid="copilot-add-menu-button"]:not([disabled])'

/**
 * Opens the input's `+` tools menu (`chat.input.toolsMenu`) once the chat is on screen, so a story
 * shows where the menu's Radix portal lands. Goes in `AIChat`'s `children`. Renders nothing.
 */
export const OpenToolsMenu = () => {
  useEffect(() => {
    // The button mounts with the chat, a few renders after this effect, so it is polled for.
    const timer = setInterval(() => {
      const button = document.querySelector(ADD_MENU_BUTTON)

      if (!button) return

      clearInterval(timer)
      // Radix's trigger opens on a primary-button `pointerdown`; a `click()` never reaches it.
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    }, 50)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return null
}

/**
 * Puts `.dark` on `<html>` while mounted — the host's side of dark mode, which reaches the portals
 * the chat wrapper's own `.dark` cannot. Goes in `AIChat`'s `children`. Renders nothing.
 */
export const HostDarkClass = () => {
  useEffect(() => {
    document.documentElement.classList.add('dark')

    return () => {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  return null
}
