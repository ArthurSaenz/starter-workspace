import type { RowData } from '@tanstack/react-table'
import { Settings2 } from 'lucide-react'

import { Button } from '../primitives/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import type { DataTableInstance } from './table-features'

export interface DataTableViewOptionsProps<TData extends RowData> {
  table: DataTableInstance<TData>
  /**
   * id → header label. The package keeps its own map instead of augmenting TanStack's
   * `ColumnMeta`: the backoffice already declares that module augmentation, and a second one
   * from a library would collide with it.
   */
  labels: Map<string, string>
}

export const DataTableViewOptions = <TData extends RowData>(props: DataTableViewOptionsProps<TData>) => {
  const { table, labels } = props

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto h-8" aria-label={T.columns}>
          <Settings2 />
          {T.columns}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuLabel>{T.toggleColumns}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {table
            .getAllColumns()
            .filter((column) => {
              return column.getCanHide()
            })
            .map((column) => {
              const label = labels.get(column.id) ?? column.id

              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => {
                    column.toggleVisibility(value === true)
                  }}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              )
            })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const T = {
  columns: 'Columns',
  toggleColumns: 'Toggle columns',
} as const
