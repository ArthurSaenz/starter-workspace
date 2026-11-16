import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { createCellRegistry } from '../cells/cell-registry'
import type { FilterConfig } from '../config'
import { DataTable } from '../core/data-table'
import { FilterBar, createFilterRegistry } from '../filters/filter-bar'

interface Row {
  id: string
}

describe('registry overrides', () => {
  it('keeps the built-in cell renderer when an override is undefined', async () => {
    const registry = createCellRegistry<Row>({ text: undefined })

    const screen = await render(
      <DataTable
        cellRegistry={registry}
        config={{
          data: [{ id: 'r1' }],
          getRowId: (row) => {
            return row.id
          },
          columns: [
            {
              id: 'id',
              label: 'Id',
              cell: {
                kind: 'text',
                value: (row) => {
                  return row.id
                },
              },
            },
          ],
        }}
      />,
    )

    await expect.element(screen.getByText('r1')).toBeInTheDocument()
  })

  it('keeps the built-in filter control when an override is undefined', async () => {
    const filters: FilterConfig[] = [{ kind: 'clear-all', id: 'clear', onClear: vi.fn() }]

    const screen = await render(<FilterBar filters={filters} registry={{ 'clear-all': undefined }} />)

    await expect.element(screen.getByRole('button', { name: 'Clear' })).toBeVisible()
    expect(createFilterRegistry({ search: undefined }).search).toBeDefined()
  })

  it('names an unknown filter kind in place and still renders the filters around it', async () => {
    const filters = [
      { kind: 'toggle', id: 'stale' },
      { kind: 'clear-all', id: 'clear', onClear: vi.fn() },
    ] as FilterConfig[]

    const screen = await render(<FilterBar filters={filters} />)

    await expect.element(screen.getByText('Unknown filter kind: "toggle"')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Clear' })).toBeVisible()
  })
})
