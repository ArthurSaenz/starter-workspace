import type { DataTableFilterBarProps } from '#root/core/data-table'
import type { DataTableProps, FilterRegistry } from '#root/index'
import { describe, expectTypeOf, it } from 'vitest'

interface Row {
  id: string
}

const Search = () => {
  return null
}

describe('filter registry', () => {
  it('is the one type behind every registry slot', () => {
    expectTypeOf<NonNullable<DataTableProps<Row>['filterRegistry']>>().toEqualTypeOf<Partial<FilterRegistry>>()
    expectTypeOf<NonNullable<DataTableFilterBarProps['registry']>>().toEqualTypeOf<Partial<FilterRegistry>>()
  })

  it('rejects a key nothing renders', () => {
    const accepted: DataTableProps<Row>['filterRegistry'] = { search: Search }
    // @ts-expect-error -- `custom` always renders `config.render()`; a registry entry for it is dead.
    const rejected: DataTableProps<Row>['filterRegistry'] = { custom: Search }

    expectTypeOf(accepted).not.toBeNever()
    expectTypeOf(rejected).not.toBeNever()
  })
})
