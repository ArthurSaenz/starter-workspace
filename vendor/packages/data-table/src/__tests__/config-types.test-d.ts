import type {
  CellKind,
  CellRenderContext,
  CheckboxSelectCellConfig,
  PaginationConfig,
  PaginationMode,
  TableColumnConfig,
  TableConfig,
  TextCellConfig,
} from '#root/config'
import { describe, expectTypeOf, it } from 'vitest'

interface MyRow {
  id: string
  name: string
  price: number
  active: boolean
}

describe('tableConfig', () => {
  it('infers the row type for every nested getter without explicit annotations', () => {
    const config: TableConfig<MyRow> = {
      data: [],
      getRowId: (row) => {
        expectTypeOf(row).toEqualTypeOf<MyRow>()

        return row.id
      },
      columns: [
        {
          id: 'name',
          label: 'Name',
          sortable: true,
          sortingValue: (row) => {
            expectTypeOf(row).toEqualTypeOf<MyRow>()

            return row.name
          },
          cell: {
            kind: 'text',
            value: (row) => {
              expectTypeOf(row).toEqualTypeOf<MyRow>()

              return row.name
            },
            className: (row) => {
              expectTypeOf(row).toEqualTypeOf<MyRow>()

              return row.active ? undefined : 'opacity-50'
            },
          },
        },
        {
          id: 'price',
          label: 'Price',
          cell: {
            kind: 'price-input',
            fields: [
              {
                id: 'adult',
                value: (row) => {
                  expectTypeOf(row).toEqualTypeOf<MyRow>()

                  return row.price
                },
                onChange: (args) => {
                  expectTypeOf(args).toEqualTypeOf<{ row: MyRow; value: string }>()
                },
              },
            ],
          },
        },
        {
          id: 'select',
          label: '',
          cell: {
            kind: 'checkbox-select',
            isSelected: (row) => {
              expectTypeOf(row).toEqualTypeOf<MyRow>()

              return row.active
            },
            onToggle: (row) => {
              expectTypeOf(row).toEqualTypeOf<MyRow>()
            },
          },
        },
      ],
      rowClassName: {
        rules: [
          {
            when: (row) => {
              expectTypeOf(row).toEqualTypeOf<MyRow>()

              return row.active
            },
            className: 'bg-muted',
          },
        ],
      },
      expandable: {
        kind: 'custom',
        render: (ctx) => {
          expectTypeOf(ctx).toEqualTypeOf<CellRenderContext<MyRow>>()

          return null
        },
      },
    }

    expectTypeOf(config.columns).toEqualTypeOf<TableColumnConfig<MyRow>[]>()
  })
})

describe('cellConfig', () => {
  it('rejects a text value getter that returns a non-scalar', () => {
    const invalidTextCell: TextCellConfig<MyRow> = {
      kind: 'text',
      // @ts-expect-error - a text value getter must return string | number | null | undefined
      value: (row) => {
        return { raw: row.name }
      },
    }

    expectTypeOf(invalidTextCell.kind).toEqualTypeOf<'text'>()
  })

  it('hands a typed render context to a custom cell', () => {
    const customCell: TableColumnConfig<MyRow> = {
      id: 'custom',
      label: 'Custom',
      cell: {
        kind: 'custom',
        render: (ctx) => {
          expectTypeOf(ctx).toEqualTypeOf<CellRenderContext<MyRow>>()
          expectTypeOf(ctx.row).toEqualTypeOf<MyRow>()
          expectTypeOf(ctx.rowIndex).toEqualTypeOf<number>()
          expectTypeOf(ctx.isExpanded).toEqualTypeOf<boolean>()
          expectTypeOf(ctx.toggleExpanded).toEqualTypeOf<() => void>()
          expectTypeOf(ctx.columnId).toEqualTypeOf<string>()

          return null
        },
      },
    }

    expectTypeOf(customCell.cell.kind).toEqualTypeOf<CellKind>()
  })

  it('requires isSelected and onToggle on a checkbox-select cell', () => {
    // @ts-expect-error - checkbox-select cannot be declared without isSelected and onToggle
    const missingHandlers: CheckboxSelectCellConfig<MyRow> = { kind: 'checkbox-select' }

    expectTypeOf(missingHandlers.isSelected).toEqualTypeOf<(row: MyRow) => boolean>()
    expectTypeOf(missingHandlers.onToggle).toEqualTypeOf<(row: MyRow) => void>()
  })

  it('types a row action onClick with the cell render context', () => {
    const actionsCell: TableColumnConfig<MyRow> = {
      id: 'actions',
      label: 'Actions',
      cell: {
        kind: 'actions',
        actions: [
          {
            id: 'save',
            kind: 'save',
            label: 'Save',
            onClick: (ctx) => {
              expectTypeOf(ctx).toEqualTypeOf<CellRenderContext<MyRow>>()
            },
          },
        ],
      },
    }

    expectTypeOf(actionsCell.id).toEqualTypeOf<string>()
  })
})

describe('paginationConfig', () => {
  it('requires the server contract in server mode', () => {
    // @ts-expect-error - server mode needs totalCount, onPageChange and onPageSizeChange
    const incomplete: PaginationConfig = { mode: 'server', page: 1, pageSize: 20 }

    expectTypeOf(incomplete.mode).toEqualTypeOf<PaginationMode>()

    const complete: PaginationConfig = {
      mode: 'server',
      page: 1,
      pageSize: 20,
      totalCount: 100,
      onPageChange: (page) => {
        expectTypeOf(page).toEqualTypeOf<number>()
      },
      onPageSizeChange: (pageSize) => {
        expectTypeOf(pageSize).toEqualTypeOf<number>()
      },
    }

    expectTypeOf(complete.mode).toEqualTypeOf<'server'>()
  })

  it('rejects server-only fields in client mode', () => {
    const clientPagination: PaginationConfig = {
      mode: 'client',
      initialPageSize: 20,
      // @ts-expect-error - totalCount belongs to server mode only
      totalCount: 100,
    }

    expectTypeOf(clientPagination.mode).toEqualTypeOf<PaginationMode>()
  })
})
