import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { createCellRegistry } from '../cells/cell-registry'
import type { TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface Row {
  id: string
}

const ROW: Row = { id: 'r1' }

const buildConfig = (column: TableColumnConfig<Row>): TableConfig<Row> => {
  return {
    data: [ROW],
    getRowId: (row) => {
      return row.id
    },
    columns: [column],
  }
}

const renderColumn = async (column: TableColumnConfig<Row>) => {
  return render(<DataTable config={buildConfig(column)} cellRegistry={createCellRegistry<Row>()} />)
}

describe('cell kinds: badge', () => {
  it('renders its value with a fixed variant', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'status',
      label: 'Status',
      cell: {
        kind: 'badge',
        value: () => {
          return 'Active'
        },
        variant: 'secondary',
      },
    }

    const screen = await renderColumn(column)

    const badge = screen.getByText('Active')

    await expect.element(badge).toBeInTheDocument()
    expect(badge.element().className).toContain('bg-secondary')
  })

  it('resolves a per-row variant getter', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'status',
      label: 'Status',
      cell: {
        kind: 'badge',
        value: () => {
          return 'Danger'
        },
        variant: () => {
          return 'destructive'
        },
      },
    }

    const screen = await renderColumn(column)

    const badge = screen.getByText('Danger')

    expect(badge.element().className).toContain('bg-destructive')
  })
})

describe('cell kinds: number-input', () => {
  it('fires onChange with the raw string and the row', async () => {
    const onChange = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'price',
      label: 'Price',
      cell: {
        kind: 'number-input',
        field: {
          id: 'r1-price',
          placeholder: 'Price',
          value: () => {
            return null
          },
          onChange,
        },
      },
    }

    const screen = await renderColumn(column)

    await screen.getByPlaceholder('Price').fill('42')

    expect(onChange).toHaveBeenCalledWith({ row: ROW, value: '42' })
  })

  it('writes the field id to the "name" attribute when idAttribute is "name"', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'price',
      label: 'Price',
      cell: {
        kind: 'number-input',
        field: {
          id: 'r1-price',
          idAttribute: 'name',
          value: () => {
            return null
          },
          onChange: vi.fn(),
        },
      },
    }

    const screen = await renderColumn(column)

    expect(screen.container.querySelector('input[name="r1-price"]')).not.toBeNull()
    expect(screen.container.querySelector('#r1-price')).toBeNull()
  })
})

describe('cell kinds: price-input', () => {
  it('stacks every field and fires the currency select onChange', async () => {
    const onCurrencyChange = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'buying',
      label: 'Buying',
      cell: {
        kind: 'price-input',
        fields: [
          {
            id: 'r1-adult',
            placeholder: 'Adult',
            value: () => {
              return 10
            },
            onChange: vi.fn(),
          },
          {
            id: 'r1-infant',
            placeholder: 'Infant',
            value: () => {
              return 5
            },
            onChange: vi.fn(),
          },
        ],
        currency: {
          value: () => {
            return 'USD'
          },
          onChange: onCurrencyChange,
          options: [
            { value: 'USD', label: '$' },
            { value: 'EUR', label: '€' },
          ],
        },
      },
    }

    const screen = await renderColumn(column)

    await expect.element(screen.getByPlaceholder('Adult')).toHaveValue(10)
    await expect.element(screen.getByPlaceholder('Infant')).toHaveValue(5)

    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: '€' }).click()

    expect(onCurrencyChange).toHaveBeenCalledWith({ row: ROW, value: 'EUR' })
  })

  it('derives each field id from the row when domId is given', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'buying',
      label: 'Buying',
      cell: {
        kind: 'price-input',
        fields: [
          {
            id: 'adult-buyingPrice',
            domId: (row) => {
              return `${row.id}-adult-buyingPrice`
            },
            value: () => {
              return 10
            },
            onChange: vi.fn(),
          },
        ],
      },
    }

    const screen = await renderColumn(column)

    expect(screen.container.querySelector('#r1-adult-buyingPrice')).not.toBeNull()
    expect(screen.container.querySelector('#adult-buyingPrice')).toBeNull()
  })
})

describe('cell kinds: currency-select', () => {
  it('renders the controlled value and fires onChange', async () => {
    const onChange = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'currency',
      label: 'Currency',
      cell: {
        kind: 'currency-select',
        value: () => {
          return 'USD'
        },
        onChange,
        options: [
          { value: 'USD', label: '$' },
          { value: 'EUR', label: '€' },
        ],
      },
    }

    const screen = await renderColumn(column)

    await expect.element(screen.getByRole('combobox')).toHaveTextContent('$')

    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: '€' }).click()

    expect(onChange).toHaveBeenCalledWith({ row: ROW, value: 'EUR' })
  })
})

describe('cell kinds: textarea', () => {
  it('fires onChange and renders the slot', async () => {
    const onChange = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'comment',
      label: 'Comment',
      cell: {
        kind: 'textarea',
        value: () => {
          return ''
        },
        onChange,
        slot: () => {
          return <span>Pinned note</span>
        },
      },
    }

    const screen = await renderColumn(column)

    await expect.element(screen.getByText('Pinned note')).toBeInTheDocument()

    await screen.getByRole('textbox').fill('looks good')

    expect(onChange).toHaveBeenCalledWith({ row: ROW, value: 'looks good' })
  })
})

describe('cell kinds: switch', () => {
  it('emits {row, checked} and defaults to the green/red toggle classes', async () => {
    const onToggle = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'active',
      label: 'Active',
      cell: {
        kind: 'switch',
        checked: () => {
          return false
        },
        onToggle,
      },
    }

    const screen = await renderColumn(column)

    const toggle = screen.getByRole('switch')

    expect(toggle.element().className).toContain('data-[state=checked]:bg-green-600')
    expect(toggle.element().className).toContain('data-[state=unchecked]:bg-red-500')

    await toggle.click()

    expect(onToggle).toHaveBeenCalledWith({ row: ROW, checked: true })
  })
})

describe('cell kinds: computed', () => {
  it('applies the predicate-based className and renders prefix/suffix adornments', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'profit',
      label: 'Profit',
      cell: {
        kind: 'computed',
        value: () => {
          return 3
        },
        className: (row) => {
          return row.id === 'r1' ? 'text-red-500' : 'text-neutral-600'
        },
        suffix: '%',
      },
    }

    const screen = await renderColumn(column)

    await expect.element(screen.getByText('%')).toBeInTheDocument()

    const input = screen.container.querySelector('input[type="text"]')

    expect(input?.className).toContain('text-red-500')
    expect((input as HTMLInputElement | null)?.value).toBe('3')
  })
})

describe('cell kinds: actions', () => {
  it('hides a hidden action and disables a disabled one', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'actions',
      label: 'Actions',
      cell: {
        kind: 'actions',
        actions: [
          {
            id: 'edit',
            kind: 'edit',
            label: 'Edit',
            onClick: vi.fn(),
            disabled: () => {
              return true
            },
          },
          {
            id: 'save',
            kind: 'save',
            label: 'Save',
            onClick: vi.fn(),
            hidden: () => {
              return true
            },
          },
        ],
      },
    }

    const screen = await renderColumn(column)

    await expect.element(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('passes the render context to edit/save onClick', async () => {
    const onClick = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'actions',
      label: 'Actions',
      cell: {
        kind: 'actions',
        actions: [{ id: 'edit', kind: 'edit', label: 'Edit', onClick }],
      },
    }

    const screen = await renderColumn(column)

    await screen.getByRole('button', { name: 'Edit' }).click()

    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ row: ROW, rowIndex: 0, columnId: 'actions' }))
  })

  it('calls the copy-link action, whose onClick writes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const column: TableColumnConfig<Row> = {
      id: 'actions',
      label: 'Actions',
      cell: {
        kind: 'actions',
        actions: [
          {
            id: 'copy',
            kind: 'copy-link',
            label: 'Copy link',
            onClick: (ctx) => {
              void navigator.clipboard.writeText(`https://example.com/${ctx.row.id}`)
            },
          },
        ],
      },
    }

    const screen = await renderColumn(column)

    await screen.getByRole('button', { name: 'Copy link' }).click()

    expect(writeText).toHaveBeenCalledWith('https://example.com/r1')
  })
})

describe('cell kinds: checkbox-select', () => {
  it('reflects isSelected and calls onToggle(row) on click', async () => {
    const onToggle = vi.fn()

    const column: TableColumnConfig<Row> = {
      id: 'select',
      label: 'Select',
      cell: {
        kind: 'checkbox-select',
        isSelected: () => {
          return true
        },
        onToggle,
      },
    }

    const screen = await renderColumn(column)

    const checkbox = screen.getByRole('checkbox')

    await expect.element(checkbox).toBeChecked()

    await checkbox.click()

    expect(onToggle).toHaveBeenCalledWith(ROW)
  })
})

describe('cell kinds: custom', () => {
  it('receives ctx with row, rowIndex and columnId', async () => {
    const column: TableColumnConfig<Row> = {
      id: 'note',
      label: 'Note',
      cell: {
        kind: 'custom',
        render: (ctx) => {
          return <span>{`${ctx.row.id}-${String(ctx.rowIndex)}-${ctx.columnId}`}</span>
        },
      },
    }

    const screen = await renderColumn(column)

    await expect.element(screen.getByText('r1-0-note')).toBeInTheDocument()
  })
})
