import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface Row {
  id: string
}

const buildConfig = (label: string): TableConfig<Row> => {
  return {
    data: [{ id: 'r1' }],
    getRowId: (row) => {
      return row.id
    },
    columns: [
      {
        id: 'id',
        label,
        cell: {
          kind: 'text',
          value: (row) => {
            return row.id
          },
        },
      },
    ],
  }
}

describe('dataTable — column labels', () => {
  it('renames a column in the columns menu when only its label changes', async () => {
    const screen = await render(<DataTable config={buildConfig('Identifier')} />)

    await screen.rerender(<DataTable config={buildConfig('Ідентифікатор')} />)
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))

    await expect.element(screen.getByRole('menuitemcheckbox', { name: 'Ідентифікатор' })).toBeInTheDocument()
  })
})
