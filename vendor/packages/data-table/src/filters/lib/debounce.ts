export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  cancel: () => void
}

/** Delays invoking `fn` until `ms` have elapsed since the last call; `cancel` drops a pending call. */
export const debounce = <Args extends unknown[]>(fn: (...args: Args) => void, ms: number): Debounced<Args> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const debounced = (...args: Args) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      timeoutId = undefined
      fn(...args)
    }, ms)
  }

  debounced.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  return debounced as Debounced<Args>
}
