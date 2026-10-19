# @wl/data-table

Declarative data tables for React. Describe your table as one config object — columns, filters, pagination, row styling — and get a complete table with sorting, a column-visibility menu, a filter bar, and fullscreen mode. No JSX needed for common tables.

Built on [TanStack Table v9](https://tanstack.com/table/latest). Works with any state management (or none).

## Features

- 🧾 **One config object** — columns, filters, pagination, styling, all plain data
- 🧩 **12 cell types** — text, badge, inputs, switch, actions, checkbox… plus `custom` for anything else
- 🔍 **8 filter types** — search, selects, comboboxes, date pickers, range slider
- 📄 **Pagination** — client-side or server-side, your choice
- 🔽 **Sorting + column visibility menu** out of the box
- ↕️ **Expandable rows** with your own panel component
- 🖥️ **Fullscreen mode** (Escape to exit)
- 🎛️ **Fully controlled** — every value comes in as a prop, every change goes out as a callback
- ⌨️ **Focus-safe** — rebuild the config on every render, inputs never lose focus while typing

## Installation

**1.** Add the workspace dependency:

```json
"devDependencies": {
  "@wl/data-table": "workspace:*"
}
```

**2.** Tell Tailwind to scan the package (in your app's global CSS, next to `@import 'tailwindcss'`):

```css
@source '../../../../../../vendor/packages/data-table/src';
```

**3.** Install and build:

```bash
pnpm install
pnpm run packages-build
```

## Quick start

```tsx
import { createCellRegistry, DataTable } from '@wl/data-table'
import type { TableConfig } from '@wl/data-table'

interface DestinationRow {
  id: string
  destination: string
  status: string
  isActive: boolean
}

const config: TableConfig<DestinationRow> = {
  data: rows,
  getRowId: (row) => row.id,

  columns: [
    {
      id: 'destination',
      label: 'Destination',
      sortable: true,
      sortingValue: (row) => row.destination,
      cell: { kind: 'text', value: (row) => row.destination },
    },
    {
      id: 'status',
      label: 'Status',
      cell: { kind: 'badge', value: (row) => row.status },
    },
    {
      id: 'isActive',
      label: 'Live',
      cell: { kind: 'switch', checked: (row) => row.isActive, onToggle: handleToggleActive },
    },
  ],

  filters: [
    { kind: 'search', id: 'q', label: 'Search', value: search, onChange: setSearch },
    { kind: 'select', id: 'region', label: 'Region', value: region, onChange: setRegion, options: regionOptions },
  ],

  pagination: {
    mode: 'server',
    page,
    pageSize,
    totalCount,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
  },

  rowClassName: { striped: true },
  fullscreen: true,
}

<DataTable config={config} cellRegistry={createCellRegistry<DestinationRow>()} />
```

> **Note:** pass `cellRegistry={createCellRegistry()}` when you use any cell type other than `text`, `custom`, or `expander`. Without it, `DataTable` only loads those three.

## Cell types

Set per column via `cell: { kind: '...', ... }`.

| Kind              | What it renders                          | Main options                                             |
| ----------------- | ---------------------------------------- | -------------------------------------------------------- |
| `text`            | plain value                              | `value(row)`, `className`                                |
| `badge`           | badge/pill                               | `value(row)`, `variant`                                  |
| `number-input`    | editable number field                    | `field: { value, onChange, onBlur }`                     |
| `price-input`     | stack of number fields + currency select | `fields[]`, `currency`                                   |
| `currency-select` | currency dropdown                        | `value`, `onChange`, `options`                           |
| `textarea`        | multiline editor                         | `value`, `onChange`, `slot(row)` for extra content below |
| `switch`          | on/off toggle                            | `checked(row)`, `onToggle`                               |
| `computed`        | read-only derived value                  | `value(row)`, conditional `className`                    |
| `actions`         | row of icon buttons                      | `actions[]` — edit / save / copy-link / custom           |
| `expander`        | chevron that opens the expanded row      | —                                                        |
| `checkbox-select` | row-selection checkbox                   | `isSelected(row)`, `onToggle(row)`                       |
| `custom`          | **anything you want**                    | `render(ctx)`                                            |

### Custom cells

When no built-in type fits, render your own component:

```tsx
{
  id: 'flights',
  label: 'Flights',
  cell: {
    kind: 'custom',
    render: ({ row }) => <FlightDetails flight={row.flight} />,
  },
}
```

`render` receives `{ row, rowIndex, isExpanded, toggleExpanded, columnId }`.

### Custom headers

By default a column header shows its `label` (with a sort menu when `sortable: true`). To render your own header — a tooltip, a select-all checkbox, screen-reader-only text — use the `header` option:

```tsx
{
  id: 'select',
  label: 'Select',
  header: () => <Checkbox checked={allSelected} onCheckedChange={toggleAll} />,
  cell: { kind: 'checkbox-select', isSelected, onToggle },
}
```

## Filter types

Set via `config.filters`. Every filter is controlled: you pass `value`, it calls `onChange`.

| Kind           | What it renders                    | Main options                   |
| -------------- | ---------------------------------- | ------------------------------ |
| `search`       | text input with debounce           | `debounceMs`, `placeholder`    |
| `select`       | single dropdown                    | `options`, `allowClear`        |
| `multiselect`  | searchable combobox with chips     | `options`, `allowCreate`       |
| `multi-date`   | calendar for picking several dates | `availableDates`               |
| `date-range`   | calendar for a from/to range       | ISO `yyyy-MM-dd` strings       |
| `number-range` | slider + min/max inputs            | `bounds`, `step`, `unitSymbol` |
| `clear-all`    | "clear filters" button             | `onClear`                      |
| `custom`       | anything                           | `render()`                     |

## Pagination

Two modes:

```tsx
// Client-side: the table slices your data itself
pagination: { mode: 'client', initialPageSize: 20 }

// Server-side: you own the page state and fetch each page
pagination: {
  mode: 'server',
  page,             // 1-based
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}
```

Omit `pagination` to render no pager at all. Need a completely custom pager? Put it in `config.tableFooter`.

## Expandable rows

```tsx
expandable: {
  kind: 'custom',
  render: ({ row }) => <DealDetailsPanel deal={row} />,
}
```

Add a column with `cell: { kind: 'expander' }` to give users the toggle chevron.

## Row styling

```tsx
rowClassName: {
  striped: true, // zebra rows
  rules: [
    { when: (row) => !row.isActive, className: 'bg-rose-50' },
    { when: (row) => row.profit < 5, className: 'outline outline-1 outline-red-500' },
  ],
}
```

Rules stack on top of striping. For full manual control use `rowClassName: { fn: (row, index) => ... }` instead.

## Row clicks

```tsx
onRowClick: (ctx) => select(ctx.row.id),
```

The whole row becomes a target. A click on a control inside the row — a checkbox, button, link or input — is left to that control, so a `checkbox-select` cell and the row handler never both fire for one click. Pair it with `rowClassName` to show the cursor and the selected state.

## Works with any state

The package has **zero state-library dependencies** — no Jotai, no Redux, no router. Keep your state wherever you like and rebuild the config on render:

```tsx
const page = useAtomValue($currentPage) // or useState, or a URL param…

const config: TableConfig<Row> = {
  ...,
  pagination: { mode: 'server', page, onPageChange: setPage, ... },
}
```

Rebuilding the config every render is safe by design: column identity is derived from the config's _shape_, not object identity, so cells don't remount and inputs keep focus while the user types.

## Styling requirements

- The consuming app must define the standard shadcn/Tailwind v4 tokens (`--color-primary`, `--color-input`, `--color-border`, `--color-muted`, `--radius`, …). Every app in this repo already does.
- The `@source` line from [Installation](#installation) is required — without it Tailwind won't generate this package's classes.
- Overlay stacking uses inline z-index values (`1450` fullscreen, `1600` popovers), overridable via `config.fullscreen.zIndexClassName`.

## FAQ

**Can I add my own cell/filter kind?**
Not as a new `kind` string — the kind unions are closed so configs stay fully typed. Use `{ kind: 'custom', render }` instead; it covers anything. (You _can_ swap the renderer behind an existing kind: `createCellRegistry({ text: MyTextCell })`.)

**Styles didn't update after I changed the package?**
Styles update instantly (Tailwind scans `src`). **Code** changes need `pnpm run build` in this package before the app's type-check sees them.

**Are the `className` options stable API?**
Treat `headerClassName` / `cellClassName` / `wrapperClassName` etc. as unstable — they exist for pixel parity with the screens this package was extracted from and may be consolidated in a future major version.

**Where do I find a full real-world example?**
Hulyo's `apps/backoffice/ui/src/features/*-catalog/` — every catalog table in that backoffice is built on this package.

## Development

```bash
cd vendor/packages/data-table
pnpm run ts-check && pnpm run eslint-check && pnpm run test
```

This package is vendored: it is maintained in `starter-workspace` and copied into consumer repos by `ik vendor sync`. Edit it there, never in a consumer's `vendor/`.

The public API is exactly what `src/index.ts` exports. Everything else under `src/` is internal and may change without notice.
