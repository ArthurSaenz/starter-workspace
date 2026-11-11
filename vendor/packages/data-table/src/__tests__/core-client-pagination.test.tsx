import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { createCellRegistry } from '../cells/cell-registry'
import type { TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface PriceRow {
  id: string
  price: string
}

const buildRows = (count: number, prefix = 'r'): PriceRow[] => {
  return Array.from({ length: count }, (_unused, index) => {
    return { id: `${prefix}${String(index)}`, price: String(index) }
  })
}

const CELL_REGISTRY = createCellRegistry<PriceRow>()

// Owns `data` like a container would: every edit rebuilds the array and the edited row.
const Harness = () => {
  const [rows, setRows] = useState(() => {
    return buildRows(15)
  })

  const config: TableConfig<PriceRow> = {
    data: rows,
    getRowId: (row) => {
      return row.id
    },
    pagination: { mode: 'client', initialPageSize: 10 },
    columns: [
      {
        id: 'price',
        label: 'Price',
        sortable: true,
        sortingValue: (row) => {
          return Number(row.price)
        },
        cell: {
          kind: 'number-input',
          field: {
            id: 'price',
            value: (row) => {
              return row.price
            },
            onChange: ({ row, value }) => {
              setRows((previous) => {
                return previous.map((candidate) => {
                  return candidate.id === row.id ? { ...candidate, price: value } : candidate
                })
              })
            },
          },
        },
      },
    ],
  }

  return (
    <>
      <DataTable config={config} cellRegistry={CELL_REGISTRY} />
      <button
        type="button"
        onClick={() => {
          setRows(buildRows(12, 'n'))
        }}
      >
        replace rows
      </button>
    </>
  )
}

describe('data table client pagination', () => {
  it('stays on the current page while a cell on it is edited', async () => {
    const screen = await render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expect.element(screen.getByText('Page 2 of 2')).toBeInTheDocument()

    const input = screen.getByRole('spinbutton').first()

    await input.click()
    await userEvent.keyboard('5')

    await expect.element(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    await expect.element(input).toHaveValue(105)
    await expect.element(input).toHaveFocus()
  })

  it('returns to the first page when the rows themselves change', async () => {
    const screen = await render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'replace rows' }))

    await expect.element(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  it('returns to the first page when the sort changes', async () => {
    const screen = await render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sort by: Price' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Desc' }))

    await expect.element(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    await expect.element(screen.getByRole('spinbutton').first()).toHaveValue(14)
  })
})
