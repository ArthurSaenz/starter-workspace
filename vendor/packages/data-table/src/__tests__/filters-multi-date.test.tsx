import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { MultiDateFilterConfig } from '../config/filter-config'
import { MultiDateFilter } from '../filters/multi-date-filter'

const buildConfig = (overrides: Partial<MultiDateFilterConfig> = {}): MultiDateFilterConfig => {
  return {
    kind: 'multi-date',
    id: 'dates',
    values: [],
    onChange: vi.fn(),
    ...overrides,
  }
}

describe('multiDateFilter', () => {
  it('renders chips and the selected count for the controlled values', async () => {
    const config = buildConfig({ values: ['2026-01-05'] })

    const screen = await render(<MultiDateFilter config={config} />)

    await expect.element(screen.getByText('2026-01-05')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '1 selected' })).toBeVisible()
  })

  it('removes a date via its chip and calls onChange without it', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange, values: ['2026-01-05', '2026-01-06'] })

    const screen = await render(<MultiDateFilter config={config} />)

    await screen.getByRole('button', { name: /remove 2026-01-05/i }).click()

    expect(onChange).toHaveBeenCalledWith(['2026-01-06'])
  })

  it('shows the placeholder and opens a calendar when there are no values', async () => {
    const screen = await render(<MultiDateFilter config={buildConfig()} />)

    await expect.element(screen.getByRole('button', { name: 'Select dates' })).toBeVisible()

    await screen.getByRole('button', { name: 'Select dates' }).click()
    await expect.element(screen.getByRole('grid')).toBeVisible()
  })
})
