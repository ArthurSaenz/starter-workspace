import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { TableConfig } from '../config'
import { DataTable } from '../core/data-table'

interface SortRow {
  id: string
  value: string
}

const WORDS = ['banana', 'Apple', 'cherry', 'apple', 'Banana', 'Zed', 'ath', 'TLV']
const DIGITS = ['item10', 'Item2', 'item1', 'v1.10', 'v1.9', 'JTR2', 'a10b', 'item2']

/**
 * The expected orders were recorded from TanStack Table v8.21.3's sorted row model. Each fixture
 * sorts differently under v9's own `'auto'`: v8 sampled the rows after the first ten, so a short
 * table compares case-sensitively and the 11th row onward picks `text` vs `alphanumeric`.
 */
const CASES = [
  {
    name: 'ten rows or fewer: case-sensitive basic',
    values: WORDS,
    asc: ['r1', 'r4', 'r7', 'r5', 'r3', 'r6', 'r0', 'r2'],
    desc: ['r2', 'r0', 'r6', 'r3', 'r5', 'r7', 'r4', 'r1'],
  },
  {
    name: 'digits after the first ten rows: alphanumeric',
    values: Array.from({ length: 24 }, (_unused, index) => {
      return (index < 10 ? WORDS[index % 8] : DIGITS[index % 8]) as string
    }),
    asc: [
      'r14',
      'r22',
      'r1',
      'r3',
      'r9',
      'r6',
      'r0',
      'r4',
      'r8',
      'r2',
      'r10',
      'r18',
      'r15',
      'r17',
      'r23',
      'r16',
      'r13',
      'r21',
      'r7',
      'r12',
      'r20',
      'r11',
      'r19',
      'r5',
    ],
    desc: [
      'r5',
      'r11',
      'r19',
      'r12',
      'r20',
      'r7',
      'r13',
      'r21',
      'r16',
      'r15',
      'r17',
      'r23',
      'r10',
      'r18',
      'r2',
      'r0',
      'r4',
      'r8',
      'r6',
      'r1',
      'r3',
      'r9',
      'r14',
      'r22',
    ],
  },
  {
    name: 'digits only in the first ten rows: text',
    values: Array.from({ length: 24 }, (_unused, index) => {
      return (index < 10 ? DIGITS[index % 8] : WORDS[index % 8]?.toLowerCase()) as string
    }),
    asc: [
      'r6',
      'r11',
      'r17',
      'r19',
      'r14',
      'r22',
      'r12',
      'r16',
      'r20',
      'r10',
      'r18',
      'r2',
      'r0',
      'r8',
      'r1',
      'r7',
      'r9',
      'r5',
      'r15',
      'r23',
      'r3',
      'r4',
      'r13',
      'r21',
    ],
    desc: [
      'r13',
      'r21',
      'r4',
      'r3',
      'r15',
      'r23',
      'r5',
      'r1',
      'r7',
      'r9',
      'r0',
      'r8',
      'r2',
      'r10',
      'r18',
      'r12',
      'r16',
      'r20',
      'r14',
      'r22',
      'r11',
      'r17',
      'r19',
      'r6',
    ],
  },
]

const buildConfig = (values: string[], desc: boolean): TableConfig<SortRow> => {
  return {
    data: values.map((value, index) => {
      return { id: `r${String(index)}`, value }
    }),
    getRowId: (row) => {
      return row.id
    },
    sorting: { initial: [{ id: 'value', desc }] },
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
      {
        id: 'value',
        label: 'Value',
        sortable: true,
        sortingValue: (row) => {
          return row.value
        },
        cell: {
          kind: 'text',
          value: (row) => {
            return row.value
          },
        },
      },
    ],
  }
}

const readBodyRowIds = (container: HTMLElement): string[] => {
  return [...container.querySelectorAll('tbody tr')].map((row) => {
    return row.querySelector('td')?.textContent ?? ''
  })
}

describe('client sorting keeps the v8 order', () => {
  CASES.forEach(({ name, values, asc, desc }) => {
    it(`${name} — asc`, async () => {
      const screen = await render(<DataTable config={buildConfig(values, false)} />)

      await expect
        .poll(() => {
          return readBodyRowIds(screen.container)
        })
        .toEqual(asc)
    })

    it(`${name} — desc`, async () => {
      const screen = await render(<DataTable config={buildConfig(values, true)} />)

      await expect
        .poll(() => {
          return readBodyRowIds(screen.container)
        })
        .toEqual(desc)
    })
  })
})
