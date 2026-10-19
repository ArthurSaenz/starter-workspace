import type { RowClassNameConfig } from '../config'
import { cn } from '../primitives/cn'

/**
 * Zebra backgrounds for `striped: true`.
 *
 * Copied from the backoffice's `getCatalog2StripedRowClassName`
 * (`apps/backoffice/ui/src/components/default/catalog2/catalog2-styles.ts`), which repeats the
 * background on `hover:` so the stripe survives hovering — the shared `TableRow` primitive
 * otherwise paints `hover:bg-muted/50` over it.
 */
export const DATA_TABLE_STRIPED_ROW_CLASSES = {
  even: 'bg-neutral-100 hover:bg-neutral-100',
  odd: 'bg-white hover:bg-white',
} as const

/**
 * Builds one row's class string from the layered config.
 *
 * Layers apply in order — stripe, then every matching rule in declaration order, then `fn` — and
 * are merged with `cn`, so a later layer wins on any Tailwind utility the earlier ones also set
 * (tailwind-merge resolves `bg-neutral-100` + `bg-emerald-100` to the latter) while unrelated
 * utilities from every layer survive.
 *
 * That is composition, not substitution: a layer cannot *remove* a class the stripe added unless
 * it sets the same utility. A table whose row styling genuinely replaces the stripe rather than
 * painting over it — the packages catalog's "replaced" rows — should declare `fn` alone and leave
 * `striped`/`rules` unset, so `fn`'s output is the whole answer.
 */
export const resolveRowClassName = <TData>(
  config: RowClassNameConfig<TData> | undefined,
  row: TData,
  rowIndex: number,
): string | undefined => {
  if (!config) {
    return undefined
  }

  const { striped, rules, fn } = config

  const layers: (string | undefined)[] = []

  if (striped) {
    const pair = striped === true ? DATA_TABLE_STRIPED_ROW_CLASSES : striped

    layers.push(rowIndex % 2 === 0 ? pair.even : pair.odd)
  }

  rules?.forEach((rule) => {
    if (rule.when(row)) {
      layers.push(rule.className)
    }
  })

  layers.push(fn?.(row, rowIndex))

  const resolved = cn(...layers)

  return resolved === '' ? undefined : resolved
}
