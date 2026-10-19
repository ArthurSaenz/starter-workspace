import type { ColumnDef } from '@tanstack/react-table'
import { useTable } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { Component } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { DataTableFeatures } from '../core/table-features'
import { DATA_TABLE_FEATURES } from '../core/table-features'
import { DataTablePagination } from '../pagination/data-table-pagination'

describe('dataTablePagination server mode', () => {
  it('renders row range and page size select', async () => {
    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 2,
          pageSize: 20,
          totalCount: 100,
          onPageChange: vi.fn(),
          onPageSizeChange: vi.fn(),
          pageSizeOptions: [10, 20, 50],
        }}
      />,
    )

    await expect.element(screen.getByText('21–40 of 100 items')).toBeInTheDocument()
    await expect.element(screen.getByText('Rows per page')).toBeInTheDocument()
  })

  it('calls onPageChange when next is clicked', async () => {
    const onPageChange = vi.fn()

    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 2,
          pageSize: 20,
          totalCount: 100,
          onPageChange,
          onPageSizeChange: vi.fn(),
        }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('calls onPageChange(1) when First is clicked and onPageChange(totalPages) when Last is clicked', async () => {
    const onPageChange = vi.fn()

    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 2,
          pageSize: 20,
          totalCount: 100,
          onPageChange,
          onPageSizeChange: vi.fn(),
        }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'First' }))
    expect(onPageChange).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('button', { name: 'Last' }))
    expect(onPageChange).toHaveBeenCalledWith(5)
  })

  it('commits a valid page number on Enter', async () => {
    const onPageChange = vi.fn()

    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 2,
          pageSize: 20,
          totalCount: 100,
          onPageChange,
          onPageSizeChange: vi.fn(),
        }}
      />,
    )

    const input = screen.getByLabelText('Page number')

    await userEvent.fill(input, '4')
    await userEvent.keyboard('{Enter}')

    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('commits a valid page number on blur', async () => {
    const onPageChange = vi.fn()

    const screen = await render(
      <div>
        <DataTablePagination
          config={{
            mode: 'server',
            page: 2,
            pageSize: 20,
            totalCount: 100,
            onPageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
        <button type="button">elsewhere</button>
      </div>,
    )

    const input = screen.getByLabelText('Page number')

    await userEvent.fill(input, '5')
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))

    expect(onPageChange).toHaveBeenCalledWith(5)
  })

  it('reverts an out-of-range page number instead of committing it', async () => {
    const onPageChange = vi.fn()

    const screen = await render(
      <div>
        <DataTablePagination
          config={{
            mode: 'server',
            page: 2,
            pageSize: 20,
            totalCount: 100,
            onPageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
        <button type="button">elsewhere</button>
      </div>,
    )

    const input = screen.getByLabelText('Page number')

    await userEvent.fill(input, '999')
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))

    expect(onPageChange).not.toHaveBeenCalled()
    await expect.element(input).toHaveValue('2')
  })

  it('calls onPageSizeChange when a new page size is selected', async () => {
    const onPageSizeChange = vi.fn()

    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 1,
          pageSize: 20,
          totalCount: 100,
          onPageChange: vi.fn(),
          onPageSizeChange,
          pageSizeOptions: [10, 20, 50],
        }}
      />,
    )

    await userEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }))
    await userEvent.click(screen.getByRole('option', { name: '50' }))

    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('hides First/Last and the page-number input when showExtendedControls is false', async () => {
    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 2,
          pageSize: 20,
          totalCount: 100,
          onPageChange: vi.fn(),
          onPageSizeChange: vi.fn(),
          showExtendedControls: false,
        }}
      />,
    )

    await expect.element(screen.getByRole('button', { name: 'First' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Last' })).not.toBeInTheDocument()
    await expect.element(screen.getByLabelText('Page number')).not.toBeInTheDocument()
    await expect.element(screen.getByText('Page 2 of 5')).toBeInTheDocument()
  })

  it('hides the row range when showRowRange is false', async () => {
    const screen = await render(
      <DataTablePagination
        config={{
          mode: 'server',
          page: 2,
          pageSize: 20,
          totalCount: 100,
          onPageChange: vi.fn(),
          onPageSizeChange: vi.fn(),
          showRowRange: false,
        }}
      />,
    )

    await expect.element(screen.getByText('21–40 of 100 items')).not.toBeInTheDocument()
    await expect.element(screen.getByText('Rows per page')).toBeInTheDocument()
  })
})

interface ClientRow {
  id: number
}

const CLIENT_TEST_DATA: ClientRow[] = Array.from({ length: 25 }, (_, index) => {
  return { id: index + 1 }
})

const CLIENT_TEST_COLUMNS: ColumnDef<DataTableFeatures, ClientRow>[] = [{ accessorKey: 'id', header: 'ID' }]

const ClientPaginationHost = () => {
  const table = useTable({
    features: DATA_TABLE_FEATURES,
    data: CLIENT_TEST_DATA,
    columns: CLIENT_TEST_COLUMNS,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  })

  return <DataTablePagination config={{ mode: 'client' }} table={table} />
}

describe('dataTablePagination client mode', () => {
  it('drives a real table instance: next/prev update pagination state and the page label', async () => {
    const screen = await render(<ClientPaginationHost />)

    await expect.element(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expect.element(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expect.element(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await expect.element(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('throws when table is missing', async () => {
    // A render-time throw crosses the browser-mode RPC boundary as an unhandled rejection
    // rather than a synchronous exception, so an error boundary is used to observe it.
    const screen = await render(
      <RenderErrorBoundary>
        <DataTablePagination config={{ mode: 'client' }} />
      </RenderErrorBoundary>,
    )

    await expect
      .element(screen.getByTestId('caught-error'))
      .toHaveTextContent('DataTablePagination: `table` is required when config.mode is "client"')
  })
})

interface RenderErrorBoundaryState {
  message: string | null
}

class RenderErrorBoundary extends Component<{ children: ReactNode }, RenderErrorBoundaryState> {
  state: RenderErrorBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  render() {
    if (this.state.message !== null) {
      return <p data-testid="caught-error">{this.state.message}</p>
    }

    return this.props.children
  }
}
