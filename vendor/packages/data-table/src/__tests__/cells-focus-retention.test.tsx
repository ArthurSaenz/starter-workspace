import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import { createCellRegistry } from '../cells/cell-registry'
import type { TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface DealRow {
  id: string
  adultPrice: string
}

/**
 * Mirrors `core-focus-stability.test.tsx`, but through the full registry's `price-input` cell
 * rather than the `custom` escape hatch — the shape every catalog container actually renders:
 * state lives outside the table, and the whole config (including the field's `onChange` closure)
 * is rebuilt from scratch on every keystroke.
 */
const PriceInputHarness = () => {
  const [rows, setRows] = useState<DealRow[]>([{ id: 'r1', adultPrice: '' }])

  const handleAdultPriceChange = (args: { row: DealRow; value: string }) => {
    setRows((previous) => {
      return previous.map((row) => {
        return row.id === args.row.id ? { ...row, adultPrice: args.value } : row
      })
    })
  }

  const config: TableConfig<DealRow> = {
    data: rows,
    getRowId: (row) => {
      return row.id
    },
    columns: [
      {
        id: 'buying',
        label: 'Buying',
        cell: {
          kind: 'price-input',
          fields: [
            {
              id: 'r1-adult',
              placeholder: 'Adult price',
              value: (row) => {
                return row.adultPrice
              },
              onChange: handleAdultPriceChange,
            },
          ],
        },
      },
    ],
  }

  return <DataTable config={config} cellRegistry={createCellRegistry<DealRow>()} />
}

describe('price-input cell focus retention', () => {
  it('keeps the input focused and mounted while the config is rebuilt on every keystroke', async () => {
    const screen = await render(<PriceInputHarness />)

    const input = screen.getByPlaceholder('Adult price')
    const elementBeforeTyping = input.element()

    await userEvent.click(input)
    await userEvent.keyboard('199')

    await expect.element(input).toHaveValue(199)
    expect(input.element()).toBe(elementBeforeTyping)
    expect(document.activeElement).toBe(elementBeforeTyping)
  })
})
