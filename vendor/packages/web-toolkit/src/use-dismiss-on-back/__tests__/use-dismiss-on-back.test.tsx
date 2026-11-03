import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { dismissTopLayer, useDismissOnBack } from '..'
import type { BackDismissTrigger } from '..'

interface LayerProps {
  isOpen: boolean
  onDismiss: (trigger: BackDismissTrigger) => void
  locationKey: string
}

const Layer = (props: LayerProps) => {
  const { isOpen, onDismiss, locationKey } = props

  useDismissOnBack({ isOpen, onDismiss, locationKey })

  return null
}

describe('useDismissOnBack', () => {
  it('leaves back to navigation when nothing is open', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={false} onDismiss={onDismiss} locationKey="/" />)

    expect(dismissTopLayer()).toBe(false)
    expect(onDismiss).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('closes the open layer on native back instead of navigating', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} locationKey="/" />)

    expect(dismissTopLayer()).toBe(true)
    expect(onDismiss).toHaveBeenCalledWith('back-button')

    screen.unmount()
  })

  it('closes the open layer when the location moves under it', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} locationKey="/results" />)

    await screen.rerender(<Layer isOpen={true} onDismiss={onDismiss} locationKey="/" />)

    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('navigation')

    screen.unmount()
  })

  it('keeps a layer that the location change itself opened', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={false} onDismiss={onDismiss} locationKey="/results" />)

    await screen.rerender(<Layer isOpen={true} onDismiss={onDismiss} locationKey="/results?modal=details" />)

    expect(onDismiss).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('closes the most recently opened layer first', async () => {
    const onDismissMenu = vi.fn()
    const onDismissModal = vi.fn()

    const screen = await render(
      <>
        <Layer isOpen={true} onDismiss={onDismissMenu} locationKey="/" />
        <Layer isOpen={true} onDismiss={onDismissModal} locationKey="/" />
      </>,
    )

    dismissTopLayer()

    expect(onDismissModal).toHaveBeenCalledTimes(1)
    expect(onDismissMenu).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('unregisters once the layer closes', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} locationKey="/" />)

    await screen.rerender(<Layer isOpen={false} onDismiss={onDismiss} locationKey="/" />)

    expect(dismissTopLayer()).toBe(false)
    expect(onDismiss).not.toHaveBeenCalled()

    screen.unmount()
  })
})
