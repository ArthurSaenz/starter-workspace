/* eslint-disable react/static-components -- usePortal returns a memoized Portal, rendered as consumers do */
import { StrictMode, Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { usePortal } from '..'

const never = new Promise<never>(() => {})

const Suspend = () => {
  throw never
}

interface OverlayProps {
  id: string
  text?: string
}

const Overlay = (props: OverlayProps) => {
  const { Portal } = usePortal(props.id)

  return <Portal>{props.text ?? 'overlay'}</Portal>
}

describe('usePortal', () => {
  it('renders into a mount point it creates and removes it on unmount', async () => {
    const screen = await render(<Overlay id="portal-created" />)

    expect(document.getElementById('portal-created')!.textContent).toBe('overlay')

    await screen.unmount()

    expect(document.getElementById('portal-created')).toBeNull()
  })

  it('keeps a shared mount point until its last user unmounts', async () => {
    const first = await render(<Overlay id="portal-shared" text="a" />)
    const second = await render(<Overlay id="portal-shared" text="b" />)

    expect(document.querySelectorAll('#portal-shared')).toHaveLength(1)

    await first.unmount()
    expect(document.getElementById('portal-shared')!.textContent).toBe('b')

    await second.unmount()
    expect(document.getElementById('portal-shared')).toBeNull()
  })

  it('shares one mount point between hooks of the same id mounted together', async () => {
    const screen = await render(
      <>
        <Overlay id="portal-together" text="a" />
        <Overlay id="portal-together" text="b" />
      </>,
    )

    expect(document.querySelectorAll('[id="portal-together"]')).toHaveLength(1)
    expect(document.getElementById('portal-together')!.textContent).toBe('ab')

    await screen.unmount()
    expect(document.getElementById('portal-together')).toBeNull()
  })

  it('survives the StrictMode effect replay', async () => {
    const screen = await render(
      <StrictMode>
        <Overlay id="portal-strict" />
      </StrictMode>,
    )

    expect(document.getElementById('portal-strict')!.textContent).toBe('overlay')

    await screen.unmount()
    expect(document.getElementById('portal-strict')).toBeNull()
  })

  it('never removes a mount point that was already in the page', async () => {
    const existing = document.createElement('div')

    existing.id = 'portal-existing'
    document.body.appendChild(existing)

    const screen = await render(<Overlay id="portal-existing" />)

    expect(existing.textContent).toBe('overlay')

    await screen.unmount()
    expect(existing.isConnected).toBe(true)
    existing.remove()
  })

  it('accepts an id that is not a valid CSS selector', async () => {
    const screen = await render(<Overlay id="portal:a.b" />)

    expect(document.getElementById('portal:a.b')!.textContent).toBe('overlay')

    await screen.unmount()
    expect(document.getElementById('portal:a.b')).toBeNull()
  })

  it('leaves no mount point behind for a render that never commits', async () => {
    const screen = await render(
      <Suspense fallback="loading">
        <Overlay id="portal-abandoned" />
        <Suspend />
      </Suspense>,
    )

    expect(document.getElementById('portal-abandoned')).toBeNull()

    await screen.unmount()
  })
})
