import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface StateRow {
  id: string
  name: string
  amount: number
}

const ROWS: StateRow[] = [
  { id: 'r1', name: 'Alice', amount: 10 },
  { id: 'r2', name: 'Bob', amount: 250 },
]

const COLUMNS: TableColumnConfig<StateRow>[] = [
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
    id: 'amount',
    label: 'Amount',
    cellClassName: (ctx) => {
      return ctx.row.amount > 100 ? 'amount-high' : undefined
    },
    cell: {
      kind: 'text',
      value: (row) => {
        return row.amount
      },
    },
  },
]

const buildConfig = (overrides: Partial<TableConfig<StateRow>> = {}): TableConfig<StateRow> => {
  return {
    data: ROWS,
    getRowId: (row) => {
      return row.id
    },
    columns: COLUMNS,
    ...overrides,
  }
}

const countSkeletons = (container: HTMLElement): number => {
  return container.querySelectorAll('tbody [data-slot="skeleton"]').length
}

const getScrollArea = (container: HTMLElement): HTMLElement => {
  const table = container.querySelector('table')

  if (!table?.parentElement) {
    throw new Error('table scroll area not rendered')
  }

  return table.parentElement
}

describe('dataTable — loading', () => {
  it('replaces the rows with skeletons, capped at ten without a pager', async () => {
    const screen = await render(<DataTable config={buildConfig({ isLoading: true })} />)

    expect(countSkeletons(screen.container)).toBe(10)
    await expect.element(screen.getByText('Alice')).not.toBeInTheDocument()
  })

  it('renders one skeleton per row of a small client page', async () => {
    const screen = await render(
      <DataTable config={buildConfig({ isLoading: true, pagination: { mode: 'client', initialPageSize: 3 } })} />,
    )

    expect(countSkeletons(screen.container)).toBe(3)
  })

  it('caps a large server page at ten skeletons', async () => {
    const config = buildConfig({
      isLoading: true,
      pagination: {
        mode: 'server',
        page: 0,
        pageSize: 50,
        totalCount: 200,
        onPageChange: vi.fn(),
        onPageSizeChange: vi.fn(),
      },
    })

    const screen = await render(<DataTable config={config} />)

    expect(countSkeletons(screen.container)).toBe(10)
  })
})

describe('dataTable — summary', () => {
  it('renders a custom summary node in place of the row count', async () => {
    const config = buildConfig({ summary: { custom: <span>custom summary</span>, visibleCount: 1, totalCount: 2 } })

    const screen = await render(<DataTable config={config} />)

    await expect.element(screen.getByText('custom summary')).toBeVisible()
    await expect.element(screen.getByText(/row\(s\) visible/)).not.toBeInTheDocument()
  })

  it('renders no row count when only one of the two counts is given', async () => {
    const screen = await render(<DataTable config={buildConfig({ summary: { visibleCount: 2 } })} />)

    await expect.element(screen.getByText('Alice')).toBeVisible()
    await expect.element(screen.getByText(/row\(s\) visible/)).not.toBeInTheDocument()
  })
})

describe('dataTable — layout', () => {
  it('caps the scroll area height by default', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    expect(getScrollArea(screen.container).className).toContain('max-h-[min(32rem,calc(100dvh-12rem))]')
  })

  it('uses a custom max-height class when given', async () => {
    const screen = await render(<DataTable config={buildConfig({ layout: { maxHeightClassName: 'max-h-40' } })} />)

    const { className } = getScrollArea(screen.container)

    expect(className).toContain('max-h-40')
    expect(className).not.toContain('32rem')
  })

  it('drops the height cap with fillHeight', async () => {
    const screen = await render(<DataTable config={buildConfig({ layout: { fillHeight: true } })} />)

    expect(getScrollArea(screen.container).className).not.toContain('max-h-')
  })
})

describe('dataTable — row context', () => {
  it('applies a function cellClassName per row', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    await expect.element(screen.getByText('250')).toBeVisible()

    const highCells = screen.container.querySelectorAll('td.amount-high')

    expect(highCells).toHaveLength(1)
    expect(highCells[0]?.textContent).toBe('250')
  })

  it('lets onRowClick expand the row through ctx.toggleExpanded', async () => {
    const config = buildConfig({
      expandable: {
        kind: 'custom',
        render: (ctx) => {
          return <div>{`details-${ctx.row.id}`}</div>
        },
      },
      onRowClick: (ctx) => {
        ctx.toggleExpanded()
      },
    })

    const screen = await render(<DataTable config={config} />)

    await screen.getByText('Bob').click()

    await expect.element(screen.getByText('details-r2')).toBeVisible()
    await expect.element(screen.getByText('details-r1')).not.toBeInTheDocument()

    await screen.getByText('Bob').click()

    await expect.element(screen.getByText('details-r2')).not.toBeInTheDocument()
  })
})
