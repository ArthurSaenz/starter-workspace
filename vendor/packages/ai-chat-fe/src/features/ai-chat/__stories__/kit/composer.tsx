import { useEffect, useRef } from 'react'

interface QueueFilesProps {
  /** Put in the attachment queue as if the traveller had picked them; keep the array stable. */
  files: File[]
}

/**
 * Opens a story on a composer with files already attached — the OS file picker cannot be opened
 * from code, so this hands the files to the chat's own hidden file input. Goes in `AIChat`'s
 * `children` (attachments must be enabled). Renders nothing.
 */
export const QueueFiles = (props: QueueFilesProps) => {
  const { files } = props

  const queuedRef = useRef(false)

  useEffect(() => {
    // CopilotChat mounts its file input with the composer, which can be after this child's effect
    // runs, so both helpers poll for their element instead of reading it once.
    const timer = setInterval(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')

      if (queuedRef.current || !input) return

      queuedRef.current = true
      clearInterval(timer)

      const transfer = new DataTransfer()

      for (const file of files) transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, 50)

    return () => {
      clearInterval(timer)
    }
  }, [files])

  return null
}

/**
 * Opens a story with the composer's "+" menu already open (`chat.input.toolsMenu` must be set).
 * Goes in `AIChat`'s `children`. Renders nothing.
 */
export const OpenToolsMenu = () => {
  const openedRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="copilot-add-menu-button"]')

      if (openedRef.current || !button || button.disabled) return

      openedRef.current = true
      clearInterval(timer)
      // The menu is a Radix dropdown: it opens on pointerdown, not on click.
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    }, 50)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return null
}
