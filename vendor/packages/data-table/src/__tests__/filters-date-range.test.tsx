import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { DateRangeFilterConfig } from '../config/filter-config'
import { DateRangeFilter } from '../filters/date-range-filter'

const buildConfig = (overrides: Partial<DateRangeFilterConfig> = {}): DateRangeFilterConfig => {
  return {
    kind: 'date-range',
    id: 'stay',
    value: {},
    onChange: vi.fn(),
    ...overrides,
  }
}

describe('dateRangeFilter', () => {
  it('shows the placeholder when no value is set', async () => {
    const screen = await render(<DateRangeFilter config={buildConfig()} />)

    await expect.element(screen.getByRole('button', { name: 'Select date range' })).toBeVisible()
  })

  it('renders the formatted controlled range', async () => {
    const config = buildConfig({ value: { from: '2026-01-05', to: '2026-01-10' } })

    const screen = await render(<DateRangeFilter config={config} />)

    await expect.element(screen.getByText('Jan 5, 2026 – Jan 10, 2026')).toBeVisible()
  })

  it('renders only the from date when to is unset', async () => {
    const config = buildConfig({ value: { from: '2026-01-05' } })

    const screen = await render(<DateRangeFilter config={config} />)

    await expect.element(screen.getByText('Jan 5, 2026')).toBeVisible()
  })

  it('opens a calendar in range mode', async () => {
    const screen = await render(<DateRangeFilter config={buildConfig()} />)

    await screen.getByRole('button', { name: 'Select date range' }).click()
    await expect.element(screen.getByRole('grid')).toBeVisible()
  })
})
