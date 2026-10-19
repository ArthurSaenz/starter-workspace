import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { createCellRegistry } from '../cells/cell-registry'
import type { FilterConfig, TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'
import { MultiSelectCombobox } from '../filters/multi-select-combobox'
import './visual-theme.css'

// Baselines are per platform (`-chromium-darwin` / `-chromium-linux`): font rendering differs, so the
// Linux set comes from CI — run the "Code quality" workflow with `visual: update` and commit its artifact.

interface DealRow {
  id: string
  destination: string
  status: 'active' | 'draft'
  price: number
}

const ROWS: DealRow[] = [
  { id: 'd1', destination: 'Lisbon', status: 'active', price: 420 },
  { id: 'd2', destination: 'Reykjavik', status: 'draft', price: 980 },
  { id: 'd3', destination: 'Tbilisi', status: 'active', price: 310 },
]

const COLUMNS: TableColumnConfig<DealRow>[] = [
  { id: 'expand', label: '', hideable: false, cell: { kind: 'expander' } },
  {
    id: 'destination',
    label: 'Destination',
    sortable: true,
    sortingValue: (row) => {
      return row.destination
    },
    cell: {
      kind: 'text',
      value: (row) => {
        return row.destination
      },
    },
  },
  {
    id: 'status',
    label: 'Status',
    cell: {
      kind: 'badge',
      value: (row) => {
        return row.status
      },
      variant: (row) => {
        return row.status === 'active' ? 'default' : 'secondary'
      },
    },
  },
  {
    id: 'price',
    label: 'Price',
    cell: {
      kind: 'text',
      value: (row) => {
        return `€${String(row.price)}`
      },
    },
  },
]

const FILTERS: FilterConfig[] = [
  { kind: 'search', id: 'q', label: 'Search', value: '', onChange: vi.fn(), placeholder: 'Destination…' },
  {
    kind: 'select',
    id: 'status',
    label: 'Status',
    value: 'active',
    onChange: vi.fn(),
    options: [
      { value: 'active', label: 'Active' },
      { value: 'draft', label: 'Draft' },
    ],
  },
  {
    kind: 'number-range',
    id: 'price',
    label: 'Price',
    value: { min: 200, max: 800 },
    onChange: vi.fn(),
    bounds: { min: 0, max: 1000 },
    unitSymbol: '€',
  },
  { kind: 'clear-all', id: 'clear', onClear: vi.fn() },
]

const CELL_REGISTRY = createCellRegistry<DealRow>()

const buildConfig = (overrides: Partial<TableConfig<DealRow>> = {}): TableConfig<DealRow> => {
  return {
    data: ROWS,
    getRowId: (row) => {
      return row.id
    },
    columns: COLUMNS,
    layout: { fillHeight: true },
    ...overrides,
  }
}

const renderTable = async (overrides: Partial<TableConfig<DealRow>> = {}) => {
  const screen = await render(
    <div data-testid="frame" className="w-[760px] p-4">
      <DataTable config={buildConfig(overrides)} cellRegistry={CELL_REGISTRY} />
    </div>,
  )

  return { screen, frame: screen.getByTestId('frame') }
}

describe('dataTable — visual', () => {
  beforeEach(async () => {
    await page.viewport(900, 700)
  })

  it('default', async () => {
    const { frame } = await renderTable({ summary: { visibleCount: 3, totalCount: 3 } })

    await expect.element(frame).toMatchScreenshot('default')
  })

  it('filters and pagination', async () => {
    const { frame } = await renderTable({ filters: FILTERS, pagination: { mode: 'client', initialPageSize: 10 } })

    await expect.element(frame).toMatchScreenshot('filters-pagination')
  })

  it('loading', async () => {
    const { frame } = await renderTable({ isLoading: true, pagination: { mode: 'client', initialPageSize: 3 } })

    await expect.element(frame).toMatchScreenshot('loading')
  })

  it('empty', async () => {
    const { frame } = await renderTable({ data: [] })

    await expect.element(frame).toMatchScreenshot('empty')
  })

  it('expanded row', async () => {
    const { screen, frame } = await renderTable({
      expandable: {
        kind: 'custom',
        render: (ctx) => {
          return <div className="p-4 text-sm">{`Itinerary for ${ctx.row.destination}`}</div>
        },
      },
    })

    await screen.getByRole('button', { name: 'Toggle row details' }).nth(1).click()
    await expect.element(screen.getByText('Itinerary for Reykjavik')).toBeVisible()

    await expect.element(frame).toMatchScreenshot('expanded-row')
  })
})

describe('multiSelectCombobox — visual', () => {
  beforeEach(async () => {
    await page.viewport(900, 700)
  })

  it('open list with chips', async () => {
    const screen = await render(
      <div className="h-80 w-80 p-4">
        <MultiSelectCombobox
          value={['lis']}
          onChange={vi.fn()}
          showSelectAll
          options={[
            { value: 'lis', label: 'Lisbon' },
            { value: 'rey', label: 'Reykjavik', description: 'Iceland' },
            { value: 'tbs', label: 'Tbilisi' },
          ]}
        />
      </div>,
    )

    await screen.getByRole('combobox').click()

    // The list is portaled to <body>, outside the rendered container, so it is captured on its own.
    await expect.element(screen.getByRole('listbox')).toMatchScreenshot('combobox-open-list')
    await expect.element(screen.getByRole('button', { name: 'Remove Lisbon' })).toBeVisible()
  })
})
