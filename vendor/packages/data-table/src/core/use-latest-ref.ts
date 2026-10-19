import { useRef } from 'react'
import type { MutableRefObject } from 'react'

/**
 * Keeps a ref pointing at the newest value.
 *
 * The assignment happens during render rather than in an effect on purpose: the column defs are
 * memoized on a structural key, so a memoized cell reads its config out of this ref *while it
 * renders*. An effect-based update would hand the cell the previous render's config — the exact
 * stale-closure bug the memoization is there to avoid. Nothing here is written conditionally, so
 * a render that React throws away leaves no state behind beyond the ref itself.
 */
export const useLatestRef = <TValue>(value: TValue): MutableRefObject<TValue> => {
  const ref = useRef(value)

  ref.current = value

  return ref
}
