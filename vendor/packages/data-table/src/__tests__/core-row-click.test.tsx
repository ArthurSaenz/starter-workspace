import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { createCellRegistry } from '../cells/cell-registry'
import type { TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface ClickRow {
  id: string
  name: string
}

const ROWS: ClickRow[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
]

const buildConfig = (onRowClick: TableConfig<ClickRow>['onRowClick'], selected: Set<string>): TableConfig<ClickRow> => {
  return {
    data: ROWS,
    getRowId: (row) => {
      return row.id
    },
    columns: [
      {
        id: 'select',
        label: 'Select',
        cell: {
          kind: 'checkbox-select',
          isSelected: (row) => {
            return selected.has(row.id)
          },
          onToggle: (row) => {
            if (selected.has(row.id)) {
              selected.delete(row.id)
            } else {
              selected.add(row.id)
            }
          },
        },
      },
      {
        id: 'name',
        label: 'Name',
        cell: {
          kind: 'text',
          value: (row) => {
            return row.name
          },
        },
      },
    ],
    pagination: false,
    headerActions: false,
    onRowClick,
  }
}

const CELL_REGISTRY = createCellRegistry<ClickRow>()

describe('dataTable onRowClick', () => {
  it('fires with the row context when a plain cell is clicked', async () => {
    const onRowClick = vi.fn()
    const screen = await render(<DataTable config={buildConfig(onRowClick, new Set())} cellRegistry={CELL_REGISTRY} />)

    await userEvent.click(screen.getByText('Bob'))

    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick.mock.calls[0]?.[0]).toMatchObject({ row: ROWS[1], rowIndex: 1 })
  })

  it('leaves a click on a control inside the row to that control', async () => {
    const onRowClick = vi.fn()
    const selected = new Set<string>()
    const screen = await render(<DataTable config={buildConfig(onRowClick, selected)} cellRegistry={CELL_REGISTRY} />)

    await userEvent.click(screen.getByRole('checkbox').first())

    expect(selected.has('r1')).toBe(true)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('renders no click handler when the config has none', async () => {
    const screen = await render(<DataTable config={buildConfig(undefined, new Set())} cellRegistry={CELL_REGISTRY} />)

    await userEvent.click(screen.getByText('Alice'))

    await expect.element(screen.getByText('Alice')).toBeInTheDocument()
  })
})
