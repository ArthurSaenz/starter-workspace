// This test IS spec acceptance criterion 2 (.omc/specs/deep-interview-data-table-package.md):
// "A table with sortable columns, column-visibility menu, fullscreen, striped rows, and server
// pagination can be declared with a single config object and zero JSX from the consumer."
// Every value inside `CONFIG` below is a primitive, a function, or a plain object — no JSX
// appears anywhere in the config literal. Only the public surface (`../index`) is imported, so
// this also doubles as a smoke test of what `@wl/data-table` actually exports.
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { TableColumnConfig, TableConfig } from '../index'
import { DataTable, createCellRegistry } from '../index'

interface DestinationRow {
  id: string
  destination: string
  status: string
  isActive: boolean
}

const ROWS: DestinationRow[] = [
  { id: 'r1', destination: 'Rome', status: 'Active', isActive: true },
  { id: 'r2', destination: 'Paris', status: 'Pending', isActive: false },
  { id: 'r3', destination: 'Oslo', status: 'Active', isActive: true },
]

const columns: TableColumnConfig<DestinationRow>[] = [
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
    },
  },
  {
    id: 'isActive',
    label: 'Live',
    cell: {
      kind: 'switch',
      checked: (row) => {
        return row.isActive
      },
      onToggle: vi.fn(),
    },
  },
]

const onSearchChange = vi.fn()
const onRegionChange = vi.fn()
const onPageChange = vi.fn()
const onPageSizeChange = vi.fn()

// The zero-JSX config: no ReactNode value appears anywhere in this object.
const CONFIG: TableConfig<DestinationRow> = {
  data: ROWS,
  getRowId: (row) => {
    return row.id
  },
  columns,
  filters: [
    {
      kind: 'search',
      id: 'q',
      label: 'Search',
      value: '',
      onChange: onSearchChange,
    },
    {
      kind: 'select',
      id: 'region',
      label: 'Region',
      value: '',
      onChange: onRegionChange,
      options: [
        { value: 'eu', label: 'Europe' },
        { value: 'as', label: 'Asia' },
      ],
    },
  ],
  pagination: {
    mode: 'server',
    page: 2,
    pageSize: 20,
    totalCount: 100,
    onPageChange,
    onPageSizeChange,
  },
  rowClassName: { striped: true },
  summary: { visibleCount: ROWS.length, totalCount: 100 },
  fullscreen: true,
}

describe('zero-JSX config (AC2)', () => {
  it('renders a header label for every configured column', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    await expect.element(screen.getByText('Destination')).toBeInTheDocument()
    await expect.element(screen.getByText('Status')).toBeInTheDocument()
    await expect.element(screen.getByText('Live')).toBeInTheDocument()
  })

  it('sorts the sortable column and flips aria-sort on the header', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    const { container } = screen
    const readAriaSort = () => {
      return container.querySelector('[aria-sort]')?.getAttribute('aria-sort')
    }
    const readDestinations = () => {
      return [...container.querySelectorAll('tbody tr')].map((row) => {
        return row.querySelectorAll('td')[0]?.textContent ?? ''
      })
    }

    expect(readAriaSort()).toBe('none')
    expect(readDestinations()).toEqual(['Rome', 'Paris', 'Oslo'])

    await userEvent.click(screen.getByRole('button', { name: 'Sort by: Destination' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Asc' }))

    expect(readAriaSort()).toBe('ascending')
    expect(readDestinations()).toEqual(['Oslo', 'Paris', 'Rome'])
  })

  it('opens the columns menu and toggles a column off and back on', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    await expect.element(screen.getByText('Status')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))

    await expect.element(screen.getByText('Status')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))

    await expect.element(screen.getByText('Status')).toBeInTheDocument()
  })

  it('shows the fullscreen toggle and portals the table into document.body on click', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))

    const dialog = screen.getByRole('dialog')

    await expect.element(dialog).toBeInTheDocument()
    expect(dialog.element().parentElement).toBe(document.body)
  })

  it('applies the default striped classes to alternating rows', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    const rows = [...screen.container.querySelectorAll('tbody tr')]

    expect(rows[0]?.className).toContain('bg-neutral-100')
    expect(rows[1]?.className).toContain('bg-white')
    expect(rows[2]?.className).toContain('bg-neutral-100')
  })

  it('renders the visible/total row-count summary from config.summary', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    await expect.element(screen.getByText('3 of 100 row(s) visible.')).toBeInTheDocument()
  })

  it('renders the server-mode row range for its page and fires onPageChange on Next', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    await expect.element(screen.getByText('21–40 of 100 items')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('renders the search and select filters and fires their onChange', async () => {
    const screen = await render(<DataTable config={CONFIG} cellRegistry={createCellRegistry<DestinationRow>()} />)

    await expect.element(screen.getByText('Search')).toBeInTheDocument()
    await expect.element(screen.getByText('Region')).toBeInTheDocument()

    // Named explicitly: the server pager's own page-number input is also a plain textbox, and
    // its rows-per-page control is also an unlabelled combobox once the region filter's is
    // discounted — `.first()` relies on the filter bar rendering above the pager in DOM order.
    await screen.getByRole('textbox', { name: 'Search…' }).fill('rome')
    expect(onSearchChange).toHaveBeenCalledWith('rome')

    await userEvent.click(screen.getByRole('combobox').first())
    await userEvent.click(screen.getByRole('option', { name: 'Europe' }))
    expect(onRegionChange).toHaveBeenCalledWith('eu')
  })
})
