import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { MultiSelectCombobox } from '../filters/multi-select-combobox'

const OPTION_COUNT = 250

const OPTIONS = Array.from({ length: OPTION_COUNT }, (_, index) => {
  const id = String(10000 + index)

  return { value: id, label: `Hotel ${id}` }
})

describe('multiSelectCombobox — options list', () => {
  // A former 100-row render cap hid every later option with no hint, so "Select all" picked hotels the
  // operator never saw (HULY-2745). The list must render every match.
  it('renders every matching option', async () => {
    const screen = await render(<MultiSelectCombobox value={[]} onChange={vi.fn()} options={OPTIONS} />)

    await screen.getByRole('combobox').click()

    await expect.element(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getByRole('option').all()).toHaveLength(OPTION_COUNT)
  })
})
