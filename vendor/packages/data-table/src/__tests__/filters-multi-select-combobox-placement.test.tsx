import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { MultiSelectCombobox } from '../filters/multi-select-combobox'

interface HarnessProps {
  anchor: 'top' | 'bottom'
}

const Harness = (props: HarnessProps) => {
  const { anchor } = props

  return (
    <div style={{ position: 'fixed', left: 0, width: 240, [anchor]: 0 }}>
      <MultiSelectCombobox value={[]} onChange={noop} options={OPTIONS} />
    </div>
  )
}

// Tailwind is not loaded in this suite, so the list is not `position: fixed` here; the inline
// offsets the component computes are what decide the placement in the app.
describe('multiSelectCombobox list placement', () => {
  it('opens below the input when there is room', async () => {
    const screen = await render(<Harness anchor="top" />)

    await screen.getByRole('combobox').click()

    const input = screen.getByRole('combobox').element().getBoundingClientRect()
    const list = screen.getByRole('listbox').element() as HTMLElement

    expect(list.style.bottom).toBe('')
    expect(Number.parseFloat(list.style.top)).toBeGreaterThanOrEqual(input.bottom)
    expect(list.style.visibility).toBe('')
  })

  it('opens above the input when the list would overflow the viewport bottom', async () => {
    const screen = await render(<Harness anchor="bottom" />)

    await screen.getByRole('combobox').click()

    const input = screen.getByRole('combobox').element().getBoundingClientRect()
    const list = screen.getByRole('listbox').element() as HTMLElement

    expect(list.style.top).toBe('')
    expect(Number.parseFloat(list.style.bottom)).toBeGreaterThanOrEqual(window.innerHeight - input.top)
    expect(list.style.maxHeight).toBe('240px')
  })
})

const noop = () => {}

const OPTION_COUNT = 13

const OPTIONS = Array.from({ length: OPTION_COUNT }, (_, index) => {
  return { value: `option-${index + 1}`, label: `Option ${index + 1}` }
})
