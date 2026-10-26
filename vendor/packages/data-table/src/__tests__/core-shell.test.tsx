import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface ShellRow {
  id: string
  name: string
  amount: number
  flagged: boolean
}

const ROWS: ShellRow[] = [
  { id: 'r1', name: 'Charlie', amount: 30, flagged: false },
  { id: 'r2', name: 'Alice', amount: 10, flagged: true },
  { id: 'r3', name: 'Bob', amount: 20, flagged: false },
]

const buildColumns = (): TableColumnConfig<ShellRow>[] => {
  return [
    {
      id: 'expand',
      label: '',
      hideable: false,
      cell: { kind: 'expander' },
    },
    {
      id: 'name',
      label: 'Name',
      sortable: true,
      sortingValue: (row) => {
        return row.name
      },
      cell: {
        kind: 'text',
        value: (row) => {
          return row.name
        },
      },
    },
    {
      id: 'amount',
      label: 'Amount',
      cell: {
        kind: 'text',
        value: (row) => {
          return row.amount
        },
      },
    },
    {
      id: 'note',
      label: 'Note',
      cell: {
        kind: 'custom',
        render: (ctx) => {
          return <span>{`note-${ctx.row.id}`}</span>
        },
      },
    },
  ]
}

const buildConfig = (overrides: Partial<TableConfig<ShellRow>> = {}): TableConfig<ShellRow> => {
  return {
    data: ROWS,
    getRowId: (row) => {
      return row.id
    },
    columns: buildColumns(),
    ...overrides,
  }
}

const readBodyRowNames = (container: HTMLElement): string[] => {
  return [...container.querySelectorAll('tbody tr')].map((row) => {
    return row.querySelectorAll('td')[1]?.textContent ?? ''
  })
}

describe('data table shell', () => {
  it('renders a header label for every column', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    await expect.element(screen.getByText('Name')).toBeInTheDocument()
    await expect.element(screen.getByText('Amount')).toBeInTheDocument()
    await expect.element(screen.getByText('Note')).toBeInTheDocument()
  })

  it('renders every configured cell kind', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    await expect.element(screen.getByText('Charlie')).toBeInTheDocument()
    await expect.element(screen.getByText('note-r1')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Toggle row details' }).first()).toBeInTheDocument()
  })

  it('cycles a sortable column through asc, desc and reset', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    const { container } = screen

    const readAriaSort = () => {
      return container.querySelector('[aria-sort]')?.getAttribute('aria-sort')
    }

    expect(readAriaSort()).toBe('none')
    expect(readBodyRowNames(container)).toEqual(['Charlie', 'Alice', 'Bob'])

    await userEvent.click(screen.getByRole('button', { name: 'Sort by: Name' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Asc' }))

    expect(readAriaSort()).toBe('ascending')
    expect(readBodyRowNames(container)).toEqual(['Alice', 'Bob', 'Charlie'])

    await userEvent.click(screen.getByRole('button', { name: 'Sort by: Name' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Desc' }))

    expect(readAriaSort()).toBe('descending')
    expect(readBodyRowNames(container)).toEqual(['Charlie', 'Bob', 'Alice'])

    await userEvent.click(screen.getByRole('button', { name: 'Sort by: Name' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clear' }))

    expect(readAriaSort()).toBe('none')
    expect(readBodyRowNames(container)).toEqual(['Charlie', 'Alice', 'Bob'])
  })

  it('hides and restores a column from the columns menu', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    await expect.element(screen.getByText('Amount')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Amount' }))

    await expect.element(screen.getByText('Amount')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Amount' }))

    await expect.element(screen.getByText('Amount')).toBeInTheDocument()
  })

  it('offers no menu entry for a column that cannot be hidden', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))

    await expect.element(screen.getByRole('menuitemcheckbox', { name: 'Note' })).toBeInTheDocument()
    await expect.element(screen.getByRole('menuitemcheckbox', { name: 'expand' })).not.toBeInTheDocument()
  })

  it('shows the empty message when the table has no data at all', async () => {
    const config = buildConfig({ data: [], isEmpty: true, messages: { empty: 'Nothing here yet.' } })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('shows the no-results message when filters excluded every row', async () => {
    const config = buildConfig({
      data: [],
      isEmpty: false,
      messages: { empty: 'Nothing here yet.', noResults: 'Nothing matches.' },
    })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('Nothing matches.')).toBeInTheDocument()
    await expect.element(screen.getByText('Nothing here yet.')).not.toBeInTheDocument()
  })

  it('layers stripe and rule classes onto the matching rows', async () => {
    const config = buildConfig({
      rowClassName: {
        striped: true,
        rules: [
          {
            when: (row) => {
              return row.flagged
            },
            className: 'text-red-500',
          },
        ],
      },
    })

    const screen = await render(<DataTable config={config} />)

    const rows = [...screen.container.querySelectorAll('tbody tr')]

    expect(rows[0]?.className).toContain('bg-neutral-100')
    expect(rows[0]?.className).not.toContain('text-red-500')
    expect(rows[1]?.className).toContain('bg-white')
    expect(rows[1]?.className).toContain('text-red-500')
    expect(rows[2]?.className).toContain('bg-neutral-100')
  })

  it('renders the sub-row panel only while a row is expanded', async () => {
    const config = buildConfig({
      expandable: {
        kind: 'custom',
        render: (ctx) => {
          return <div>{`panel for ${ctx.row.name}`}</div>
        },
      },
    })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('panel for Charlie')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle row details' }).first())

    await expect.element(screen.getByText('panel for Charlie')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle row details' }).first())

    await expect.element(screen.getByText('panel for Charlie')).not.toBeInTheDocument()
  })

  it('renders the row-count summary', async () => {
    const config = buildConfig({ summary: { visibleCount: 3, totalCount: 42 } })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('3 of 42 row(s) visible.')).toBeInTheDocument()
  })

  it('names the offending kind when no renderer is registered for it', async () => {
    const config = buildConfig({
      columns: [
        {
          id: 'switchy',
          label: 'Active',
          cell: {
            kind: 'switch',
            checked: () => {
              return true
            },
            onToggle: () => {
              return undefined
            },
          },
        },
      ],
    })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('Unknown cell kind: "switch"').first()).toBeInTheDocument()
  })
})
