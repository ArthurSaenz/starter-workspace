/** A conditional row class: applied to every row `when` returns true for. */
export interface RowClassRule<TData> {
  when: (row: TData) => boolean
  className: string
}

/**
 * Row styling, from the cheapest form to the fullest.
 *
 * `striped` takes the package default zebra classes when true, or an explicit even/odd pair.
 * `rules` are appended in order on top of the stripe.
 * `fn` is the escape hatch for rows whose class is not additive — the packages catalog swaps the
 * stripe for a "replaced" class rather than layering on top of it.
 */
export interface RowClassNameConfig<TData> {
  striped?: boolean | { even: string; odd: string }
  rules?: RowClassRule<TData>[]
  fn?: (row: TData, rowIndex: number) => string | undefined
}
