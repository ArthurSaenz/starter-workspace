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
