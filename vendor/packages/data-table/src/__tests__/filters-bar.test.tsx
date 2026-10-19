import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { FilterConfig } from '../config/filter-config'
import { FilterBar } from '../filters/filter-bar'

describe('filterBar', () => {
  it('wraps each non-custom filter kind with its config.label', async () => {
    const filters: FilterConfig[] = [
      { kind: 'search', id: 'q', label: 'Search', value: '', onChange: vi.fn() },
      { kind: 'clear-all', id: 'clear', label: 'Reset', onClear: vi.fn() },
    ]

    const screen = await render(<FilterBar filters={filters} />)

    await expect.element(screen.getByText('Search')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Reset' })).toBeVisible()
  })

  it('dispatches every built-in kind to its control under its label', async () => {
    const filters: FilterConfig[] = [
      { kind: 'select', id: 'status', label: 'Status', value: '', onChange: vi.fn(), options: [] },
      { kind: 'multiselect', id: 'tags', label: 'Tags', values: [], onChange: vi.fn(), options: [] },
      { kind: 'multi-date', id: 'dates', label: 'Dates', values: [], onChange: vi.fn() },
      { kind: 'date-range', id: 'period', label: 'Period', value: {}, onChange: vi.fn() },
      {
        kind: 'number-range',
        id: 'price',
        label: 'Price',
        value: { min: 0, max: 10 },
        onChange: vi.fn(),
        bounds: { min: 0, max: 10 },
      },
    ]

    const screen = await render(<FilterBar filters={filters} />)

    for (const label of ['Status', 'Tags', 'Dates', 'Period', 'Price']) {
      await expect.element(screen.getByText(label, { exact: true })).toBeVisible()
    }

    await expect.element(screen.getByRole('combobox').nth(1)).toBeVisible()
    await expect.element(screen.getByRole('spinbutton', { name: 'Minimum' })).toBeVisible()
  })

  it('renders a custom filter kind via config.render, without a FilterField wrapper', async () => {
    const filters: FilterConfig[] = [
      {
        kind: 'custom',
        id: 'custom-1',
        render: () => {
          return <span>Custom slot</span>
        },
      },
    ]

    const screen = await render(<FilterBar filters={filters} />)

    await expect.element(screen.getByText('Custom slot')).toBeVisible()
  })

  it('lets a registry override replace a built-in kind component', async () => {
    const filters: FilterConfig[] = [{ kind: 'clear-all', id: 'clear', onClear: vi.fn() }]

    const screen = await render(
      <FilterBar
        filters={filters}
        registry={{
          'clear-all': () => {
            return <span>Overridden</span>
          },
        }}
      />,
    )

    await expect.element(screen.getByText('Overridden')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })
})
