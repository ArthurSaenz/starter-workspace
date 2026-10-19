import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface EditableRow {
  id: string
  note: string
}

/**
 * The shape every catalog container has: state lives outside the table, and the whole config —
 * arrays, getters, callbacks and the cell's `render` closure — is rebuilt from scratch on every
 * render. An input inside a cell must survive that.
 */
const EditableHarness = () => {
  const [rows, setRows] = useState<EditableRow[]>([
    { id: 'r1', note: '' },
    { id: 'r2', note: '' },
  ])

  const handleNoteChange = (args: { id: string; value: string }) => {
    setRows((previous) => {
      return previous.map((row) => {
        return row.id === args.id ? { ...row, note: args.value } : row
      })
    })
  }

  const config: TableConfig<EditableRow> = {
    data: rows,
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
      {
        id: 'note',
        label: 'Note',
        cell: {
          kind: 'custom',
          render: (ctx) => {
            return (
              <input
                aria-label={`note for ${ctx.row.id}`}
                value={ctx.row.note}
                onChange={(event) => {
                  handleNoteChange({ id: ctx.row.id, value: event.target.value })
                }}
              />
            )
          },
        },
      },
    ],
  }

  return <DataTable config={config} />
}

describe('data table focus stability', () => {
  it('keeps a cell input focused and mounted while the config is rebuilt on every keystroke', async () => {
    const screen = await render(<EditableHarness />)

    const input = screen.getByRole('textbox', { name: 'note for r1' })
    const elementBeforeTyping = input.element()

    await userEvent.click(input)
    await userEvent.keyboard('hello')

    await expect.element(input).toHaveValue('hello')
    expect(input.element()).toBe(elementBeforeTyping)
    expect(document.activeElement).toBe(elementBeforeTyping)
  })

  it('routes the edits of each row to its own input', async () => {
    const screen = await render(<EditableHarness />)

    const first = screen.getByRole('textbox', { name: 'note for r1' })
    const second = screen.getByRole('textbox', { name: 'note for r2' })

    await userEvent.click(first)
    await userEvent.keyboard('one')
    await userEvent.click(second)
    await userEvent.keyboard('two')

    await expect.element(first).toHaveValue('one')
    await expect.element(second).toHaveValue('two')
    expect(document.activeElement).toBe(second.element())
  })
})
