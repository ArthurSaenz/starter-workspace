import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { dismissTopLayer, subscribeHasOpenLayers, useDismissOnBack } from '..'
import type { BackDismissTrigger } from '..'

interface LayerProps {
  isOpen: boolean
  onDismiss: (trigger: BackDismissTrigger) => void
}

const Layer = (props: LayerProps) => {
  const { isOpen, onDismiss } = props

  useDismissOnBack({ isOpen, onDismiss })

  return null
}

describe('useDismissOnBack', () => {
  it('leaves back to navigation when nothing is open', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={false} onDismiss={onDismiss} />)

    expect(dismissTopLayer()).toBe(false)
    expect(onDismiss).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('closes the open layer on native back instead of navigating', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} />)

    expect(dismissTopLayer()).toBe(true)
    expect(onDismiss).toHaveBeenCalledWith('back-button')

    screen.unmount()
  })

  it('closes the open layer when the user traverses history under it', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} />)

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('navigation')

    screen.unmount()
  })

  it('stays open while the app itself pushes or replaces the URL under it', async () => {
    const onDismiss = vi.fn()
    const initialUrl = window.location.href
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} />)

    window.history.pushState(null, '', '?modal=details')
    window.history.replaceState(null, '', '?modal=details&campaign=1')

    expect(onDismiss).not.toHaveBeenCalled()

    window.history.replaceState(null, '', initialUrl)
    screen.unmount()
  })

  it('stops listening for history traversal once the layer closes', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} />)

    await screen.rerender(<Layer isOpen={false} onDismiss={onDismiss} />)
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(onDismiss).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('closes the most recently opened layer first', async () => {
    const onDismissMenu = vi.fn()
    const onDismissModal = vi.fn()

    const screen = await render(
      <>
        <Layer isOpen={true} onDismiss={onDismissMenu} />
        <Layer isOpen={true} onDismiss={onDismissModal} />
      </>,
    )

    dismissTopLayer()

    expect(onDismissModal).toHaveBeenCalledTimes(1)
    expect(onDismissMenu).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('unregisters once the layer closes', async () => {
    const onDismiss = vi.fn()
    const screen = await render(<Layer isOpen={true} onDismiss={onDismiss} />)

    await screen.rerender(<Layer isOpen={false} onDismiss={onDismiss} />)

    expect(dismissTopLayer()).toBe(false)
    expect(onDismiss).not.toHaveBeenCalled()

    screen.unmount()
  })

  it('reports open layers only on the first open and the last close', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeHasOpenLayers(listener)

    const screen = await render(
      <>
        <Layer isOpen={true} onDismiss={vi.fn()} />
        <Layer isOpen={true} onDismiss={vi.fn()} />
      </>,
    )

    expect(listener.mock.calls).toEqual([[false], [true]])

    await screen.rerender(
      <>
        <Layer isOpen={true} onDismiss={vi.fn()} />
        <Layer isOpen={false} onDismiss={vi.fn()} />
      </>,
    )

    expect(listener.mock.calls).toEqual([[false], [true]])

    screen.unmount()

    expect(listener.mock.calls).toEqual([[false], [true], [false]])

    unsubscribe()
  })
})
