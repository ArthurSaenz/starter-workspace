import type { ExpandedState } from '@tanstack/react-table'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface EditableTableProps {
  controlled: boolean
}

/** Mimics a consumer whose store hands the table a new `data` array after a row is edited. */
const EditableTable = (props: EditableTableProps) => {
  const { controlled } = props

  const [data, setData] = useState(ROWS)
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const config: TableConfig<PersistenceRow> = {
    data,
    getRowId: (row) => {
      return row.id
    },
    columns: COLUMNS,
    expandable: {
      kind: 'custom',
      render: (ctx) => {
        return <div>{`details-${ctx.row.id}`}</div>
      },
      ...(controlled ? { expanded, onExpandedChange: setExpanded } : {}),
    },
  }

  const handleEditBob = () => {
    setData((previous) => {
      return previous.map((row) => {
        return row.id === 'r2' ? { ...row, name: 'Bob (edited)' } : row
      })
    })
  }

  return (
    <>
      <button type="button" onClick={handleEditBob}>
        edit bob
      </button>
      <DataTable config={config} />
    </>
  )
}

interface PersistenceRow {
  id: string
  name: string
}

const ROWS: PersistenceRow[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
]

const COLUMNS: TableColumnConfig<PersistenceRow>[] = [
  { id: 'expand', label: '', cell: { kind: 'expander' } },
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
]

describe('expanded rows across data updates', () => {
  it.each([
    ['table-owned expansion', false],
    ['consumer-owned expansion', true],
  ])('keeps the panel open after the row data is replaced (%s)', async (_label, controlled) => {
    const screen = await render(<EditableTable controlled={controlled} />)

    const toggles = screen.getByRole('button', { name: 'Toggle row details' })

    await toggles.nth(1).click()

    await expect.element(screen.getByText('details-r2')).toBeVisible()

    await screen.getByText('edit bob').click()

    await expect.element(screen.getByText('Bob (edited)')).toBeVisible()
    await expect.element(screen.getByText('details-r2')).toBeVisible()
    await expect.element(screen.getByText('details-r1')).not.toBeInTheDocument()
  })
})
