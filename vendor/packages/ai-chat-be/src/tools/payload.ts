/**
 * 8 KB is roughly 2k input tokens on the next agent hop — affordable twice within the hop
 * budget, and small enough that `capHistory`'s 300k character budget never becomes the
 * binding constraint on a tool-using turn.
 */
export const MAX_TOOL_RESULT_CHARS = 8_000

// The list a caller would want shortened first, not merely the first array encountered:
// `loyalty_sources` carries `factIds` on every entry, and cutting those would lose the
// provenance the payload exists to deliver. An unrecognised array is NOT a fallback — a tool
// whose list is not named here gets the refusal shape, because shortening an array this
// function does not understand can silently drop the very field that made the result useful.
const PREFERRED_ITEM_KEYS = ['items', 'facts', 'sources', 'programmes'] as const

const REFUSAL = {
  truncated: true,
  cappedShown: 0,
  cappedFrom: 0,
  // Read by the model: a next step it can take, not only what went wrong.
  omitted: 'the result was too large to return: narrow the call — fewer nights or chains, or one hotel',
} as const

const serializedLength = (value: unknown): number => {
  return (JSON.stringify(value) ?? '').length
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const itemsKeyOf = (value: Record<string, unknown>): string | undefined => {
  return PREFERRED_ITEM_KEYS.find((key) => {
    return Array.isArray(value[key])
  })
}

// Serialized length grows monotonically with the prefix length, so the largest fitting
// prefix is a binary search rather than a scan.
const largestFittingPrefix = (
  build: (count: number) => unknown,
  itemCount: number,
  max: number,
): { count: number; payload: unknown } => {
  let low = 0
  let high = itemCount
  let best = { count: 0, payload: build(0) }

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const payload = build(mid)

    if (serializedLength(payload) <= max) {
      best = { count: mid, payload }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

/**
 * Keeps a tool result under `max` characters by dropping whole items off the end of its
 * item list, never by cutting the serialized JSON — a truncated string would reach the
 * model as unparseable and it would guess at the rest.
 *
 * The cap reports itself in its OWN fields — `cappedShown` and `cappedFrom` — and never
 * writes `total`. `total` belongs to the producer and means how many rows matched the query,
 * which is a different number from how many survived the cap: overwriting it would make a
 * search tell the traveller only as many rows matched as fitted in 8 KB.
 */
export const capPayload = (value: unknown, max: number = MAX_TOOL_RESULT_CHARS): unknown => {
  if (serializedLength(value) <= max) {
    return value
  }

  if (!isRecord(value)) {
    return REFUSAL
  }

  const key = itemsKeyOf(value)

  if (key === undefined) {
    return REFUSAL
  }

  const items = value[key] as unknown[]

  const build = (count: number): unknown => {
    return { ...value, [key]: items.slice(0, count), truncated: true, cappedShown: count, cappedFrom: items.length }
  }

  const best = largestFittingPrefix(build, items.length, max)

  // Zero items can still overflow when the non-list fields alone exceed the cap, and the
  // binary search has nothing left to drop — return the refusal rather than a payload that
  // silently breaks the budget it exists to enforce.
  return serializedLength(best.payload) <= max ? best.payload : REFUSAL
}
