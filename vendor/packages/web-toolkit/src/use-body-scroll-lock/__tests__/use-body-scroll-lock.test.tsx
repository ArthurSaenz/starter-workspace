import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { disablePageScroll, enablePageScroll, useBodyScrollLock } from '..'

interface PanelProps {
  locked?: boolean
}

const Panel = (props: PanelProps) => {
  const ref = useRef<HTMLDivElement>(null)

  useBodyScrollLock(ref, props.locked === undefined ? undefined : { locked: props.locked })

  return <div ref={ref} />
}

const isPageLocked = () => {
  return document.body.hasAttribute('data-noscroll-target-scroll-disabled')
}

afterEach(() => {
  while (isPageLocked()) enablePageScroll()
})

describe('useBodyScrollLock', () => {
  it('locks the page while mounted, by default', async () => {
    const screen = await render(<Panel />)

    await screen.rerender(<Panel />)
    expect(isPageLocked()).toBe(true)

    await screen.unmount()
    expect(isPageLocked()).toBe(false)
  })

  it('releases its lock when switched to unlocked', async () => {
    const screen = await render(<Panel locked={true} />)

    await screen.rerender(<Panel locked={false} />)
    expect(isPageLocked()).toBe(false)
  })

  it('leaves a lock held by someone else alone while unlocked', async () => {
    disablePageScroll()

    const screen = await render(<Panel locked={false} />)

    await screen.rerender(<Panel locked={false} />)
    await screen.rerender(<Panel locked={true} />)
    await screen.rerender(<Panel locked={false} />)
    await screen.unmount()

    expect(isPageLocked()).toBe(true)
  })

  it('marks opted-in scrollable areas while the page is locked by hand', () => {
    const area = document.createElement('div')

    area.setAttribute('data-noscroll-scrollable', '')
    document.body.append(area)

    disablePageScroll()
    expect(area.hasAttribute('data-noscroll-target-scrollable')).toBe(true)

    enablePageScroll()
    expect(area.hasAttribute('data-noscroll-target-scrollable')).toBe(false)

    area.remove()
  })

  it('does nothing without a target element', async () => {
    const Detached = () => {
      useBodyScrollLock({ current: null })

      return null
    }

    await render(<Detached />)

    expect(isPageLocked()).toBe(false)
  })
})
