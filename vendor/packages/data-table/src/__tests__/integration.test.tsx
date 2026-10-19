import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface IntegrationRow {
  id: string
  name: string
  status: string
}

const ROWS: IntegrationRow[] = [
  { id: 'r1', name: 'Alice', status: 'active' },
  { id: 'r2', name: 'Bob', status: 'inactive' },
]

const buildColumns = (): TableColumnConfig<IntegrationRow>[] => {
  return [
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
    {
      id: 'status',
      label: 'Status',
      cell: {
        kind: 'text',
        value: (row) => {
          return row.status
        },
      },
    },
  ]
}

describe('data table integration (real defaults, no components override)', () => {
  it('renders the real filter bar and server pagination, and forwards their callbacks', async () => {
    const onSearchChange = vi.fn()
    const onStatusChange = vi.fn()
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()

    const config: TableConfig<IntegrationRow> = {
      data: ROWS,
      getRowId: (row) => {
        return row.id
      },
      columns: buildColumns(),
      filters: [
        { kind: 'search', id: 'q', label: 'Search', value: '', onChange: onSearchChange },
        {
          kind: 'select',
          id: 'status',
          label: 'Status',
          value: '',
          onChange: onStatusChange,
          options: [
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ],
        },
      ],
      pagination: {
        mode: 'server',
        page: 1,
        pageSize: 20,
        totalCount: 50,
        onPageChange,
        onPageSizeChange,
      },
      summary: { visibleCount: 2, totalCount: 2 },
    }

    const screen = await render(<DataTable config={config} />)

    // Real FilterBar: labels from config.filters, wrapped by the real FilterField. "Status" is
    // ambiguous with the "Status" column header, so the select filter's presence is asserted via
    // its combobox role instead (checked further down, alongside its onChange wiring). It renders
    // before the rows-per-page combobox in the pagination bar, hence `.first()`.
    await expect.element(screen.getByText('Search')).toBeInTheDocument()
    await expect.element(screen.getByRole('combobox').first()).toBeInTheDocument()

    // Real DataTablePagination in server mode: the row-range label and rows-per-page control.
    await expect.element(screen.getByText('1–20 of 50 items')).toBeInTheDocument()
    await expect.element(screen.getByText('Rows per page')).toBeInTheDocument()

    // Real DataTableRowCount summary.
    await expect.element(screen.getByText('2 of 2 row(s) visible.')).toBeInTheDocument()

    await screen.getByRole('textbox', { name: 'Search…' }).fill('a')
    expect(onSearchChange).toHaveBeenCalledWith('a')

    await screen.getByRole('combobox').first().click()
    await screen.getByRole('option', { name: 'Inactive' }).click()
    expect(onStatusChange).toHaveBeenCalledWith('inactive')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('drives the table with the real client-mode pagination controls when no components override is given', async () => {
    const config: TableConfig<IntegrationRow> = {
      data: ROWS,
      getRowId: (row) => {
        return row.id
      },
      columns: buildColumns(),
      pagination: { mode: 'client', initialPageSize: 1 },
    }

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('Alice')).toBeInTheDocument()
    await expect.element(screen.getByText('Bob')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await expect.element(screen.getByText('Bob')).toBeInTheDocument()
    await expect.element(screen.getByText('Alice')).not.toBeInTheDocument()
  })

  it('renders nothing for the pagination slot when config.pagination is omitted', async () => {
    const config: TableConfig<IntegrationRow> = {
      data: ROWS,
      getRowId: (row) => {
        return row.id
      },
      columns: buildColumns(),
    }

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('Rows per page')).not.toBeInTheDocument()
  })
})
