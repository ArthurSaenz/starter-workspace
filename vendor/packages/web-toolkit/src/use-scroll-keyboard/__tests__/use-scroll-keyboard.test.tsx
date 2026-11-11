import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { useScrollKeyboard } from '..'

interface SheetProps {
  withScrollRef?: boolean
  mobileInput?: boolean
}

const Sheet = (props: SheetProps) => {
  const scrollRef = useRef<HTMLDivElement>(null)

  useScrollKeyboard({ scrollRef: props.withScrollRef === false ? undefined : scrollRef })

  return (
    <div ref={scrollRef} data-testid="sheet">
      <input data-mobile-input={props.mobileInput === false ? undefined : 'true'} />
    </div>
  )
}

const nextFrames = () => {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 60)
      })
    })
  })
}

const mountFocused = async (props: SheetProps = {}) => {
  const screen = await render(<Sheet {...props} />)
  const sheet = document.querySelector<HTMLDivElement>('[data-testid="sheet"]')!
  const input = sheet.querySelector('input')!

  input.focus()

  return { screen, sheet, input }
}

afterEach(() => {
  for (const sheet of document.querySelectorAll('[data-testid="sheet"]')) sheet.remove()
})

describe('useScrollKeyboard', () => {
  it('blurs the mobile input when its container scrolls', async () => {
    const { screen, sheet, input } = await mountFocused()

    sheet.dispatchEvent(new Event('scroll'))
    await nextFrames()

    expect(document.activeElement).not.toBe(input)
    await screen.unmount()
  })

  it('stops listening to the container once unmounted', async () => {
    const { screen, sheet, input } = await mountFocused()

    await screen.unmount()
    document.body.appendChild(sheet)
    input.focus()

    sheet.dispatchEvent(new Event('scroll'))
    await nextFrames()

    expect(document.activeElement).toBe(input)
  })

  it('drops a blur still pending when it unmounts', async () => {
    const { screen, sheet, input } = await mountFocused()

    sheet.dispatchEvent(new Event('scroll'))
    sheet.dispatchEvent(new Event('scroll'))
    await screen.unmount()
    document.body.appendChild(sheet)
    input.focus()
    await nextFrames()

    expect(document.activeElement).toBe(input)
  })

  it('leaves a focused input alone when it is not the mobile input', async () => {
    const { screen, sheet, input } = await mountFocused({ mobileInput: false })

    sheet.dispatchEvent(new Event('scroll'))
    await nextFrames()

    expect(document.activeElement).toBe(input)
    await screen.unmount()
  })

  it('does nothing without a scroll container', async () => {
    const { screen, sheet, input } = await mountFocused({ withScrollRef: false })

    sheet.dispatchEvent(new Event('scroll'))
    await nextFrames()

    expect(document.activeElement).toBe(input)
    await screen.unmount()
  })
})
