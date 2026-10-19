import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { createCellRegistry } from '../cells/cell-registry'
import type { TableColumnConfig, TableConfig, TextCellConfig } from '../config'
import type { CellRendererProps } from '../core/cell-renderer-types'
import { DataTable } from '../core/data-table'

interface Row {
  id: string
  name: string
}

const ROW: Row = { id: 'r1', name: 'Charlie' }

/**
 * `CellConfig` is a closed union (see config/cell-config.ts), so a column cannot declare a `kind`
 * the union does not list — there is no escape hatch for registering a brand-new discriminant from
 * outside the package. `createCellRegistry`'s `extra` parameter is therefore only reachable to
 * *override* one of the twelve built-in kinds, not to add a new one; this test demonstrates that
 * (overriding `text`) and documents why the "new kind" half of the brief is not exercisable against
 * the current `CellConfig` type.
 */
const buildConfig = (): TableConfig<Row> => {
  return {
    data: [ROW],
    getRowId: (row) => {
      return row.id
    },
    columns: [
      {
        id: 'name',
        label: 'Name',
        cell: {
          kind: 'text',
          value: (row) => {
            return row.name
          },
        },
      } satisfies TableColumnConfig<Row>,
    ],
  }
}

type OverriddenTextProps = CellRendererProps<Row, TextCellConfig<Row>>

describe('createCellRegistry extension', () => {
  it('overrides a built-in kind when extra is provided, spread last', async () => {
    const OverriddenText = (props: OverriddenTextProps) => {
      const { config, row } = props

      return <strong>{`overridden: ${String(config.value(row))}`}</strong>
    }

    const registry = createCellRegistry<Row>({ text: OverriddenText })

    const screen = await render(<DataTable config={buildConfig()} cellRegistry={registry} />)

    await expect.element(screen.getByText('overridden: Charlie')).toBeInTheDocument()
    await expect.element(screen.getByText('Charlie', { exact: true })).not.toBeInTheDocument()
  })

  it('falls back to the built-in renderer for every kind extra does not touch', async () => {
    const registry = createCellRegistry<Row>({})

    const screen = await render(<DataTable config={buildConfig()} cellRegistry={registry} />)

    await expect.element(screen.getByText('Charlie')).toBeInTheDocument()
  })
})
