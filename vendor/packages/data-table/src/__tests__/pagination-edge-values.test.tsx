import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { ServerPaginationConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'
import { DataTablePagination } from '../pagination/data-table-pagination'

const buildServerConfig = (overrides: Partial<ServerPaginationConfig> = {}): ServerPaginationConfig => {
  return {
    mode: 'server',
    page: 1,
    pageSize: 10,
    totalCount: 100,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  }
}

interface Row {
  id: string
}

const buildTableConfig = (overrides: Partial<TableConfig<Row>> = {}): TableConfig<Row> => {
  return {
    data: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
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
    ...overrides,
  }
}

describe('dataTablePagination — values at the edge of the config', () => {
  it('treats a page below 1 as the first page', async () => {
    const screen = await render(
      <DataTablePagination config={buildServerConfig({ page: 0, showExtendedControls: false })} />,
    )

    await expect.element(screen.getByText('1–10 of 100 items')).toBeInTheDocument()
    await expect.element(screen.getByText('Page 1 of 10')).toBeInTheDocument()
  })

  it('treats a page that is not a number as the first page', async () => {
    const screen = await render(<DataTablePagination config={buildServerConfig({ page: Number.NaN })} />)

    await expect.element(screen.getByText('1–10 of 100 items')).toBeInTheDocument()
  })

  it('keeps the page count finite for a page size of 0', async () => {
    const onPageChange = vi.fn()

    const screen = await render(
      <DataTablePagination config={buildServerConfig({ pageSize: 0, totalCount: 7, onPageChange })} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Last' }))

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('shows the current page size even when the options do not list it', async () => {
    const screen = await render(
      <DataTablePagination config={buildServerConfig({ pageSize: 30, pageSizeOptions: [10, 20, 50] })} />,
    )

    await expect.element(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveTextContent('30')
  })
})

describe('dataTable — page sizes at the edge of the config', () => {
  it('still shows a skeleton while loading a server page whose size is 0', async () => {
    const config = buildTableConfig({ isLoading: true, pagination: buildServerConfig({ pageSize: 0 }) })

    const screen = await render(<DataTable config={config} />)

    expect(screen.container.querySelectorAll('tbody [data-slot="skeleton"]')).toHaveLength(1)
  })

  it('pages a client table whose initial page size is 0 one row at a time', async () => {
    const config = buildTableConfig({ pagination: { mode: 'client', initialPageSize: 0 } })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.container.querySelectorAll('tbody tr')).toHaveLength(1)
  })
})
