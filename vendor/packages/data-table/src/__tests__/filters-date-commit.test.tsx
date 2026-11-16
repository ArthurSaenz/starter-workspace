import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { DateRangeFilter } from '../filters/date-range-filter'
import { MultiDateFilter } from '../filters/multi-date-filter'

describe('date filters — committing a change', () => {
  it('opens on the month of the stored range and emits the picked day as yyyy-MM-dd', async () => {
    const onChange = vi.fn()

    const screen = await render(
      <DateRangeFilter config={{ kind: 'date-range', id: 'stay', value: { from: '2026-01-05' }, onChange }} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Jan 5, 2026' }))
    await userEvent.click(page.getByRole('button', { name: /January 12th/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ from: '2026-01-05', to: '2026-01-12' })
  })

  it('opens on the month of the selection and deselects a picked day', async () => {
    const onChange = vi.fn()

    const screen = await render(
      <MultiDateFilter config={{ kind: 'multi-date', id: 'days', values: ['2026-01-05', '2026-01-09'], onChange }} />,
    )

    await userEvent.click(screen.getByRole('button', { name: '2 selected' }))
    await userEvent.click(page.getByRole('button', { name: /January 9th/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(['2026-01-05'])
  })
})
