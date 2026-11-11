export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  cancel: () => void
  flush: () => void
}

/**
 * Delays invoking `fn` until `ms` have elapsed since the last call; `cancel` drops a pending call,
 * `flush` makes it now.
 */
export const debounce = <Args extends unknown[]>(fn: (...args: Args) => void, ms: number): Debounced<Args> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let pendingArgs: Args | undefined

  const debounced = (...args: Args) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }

    pendingArgs = args
    timeoutId = setTimeout(debounced.flush, ms)
  }

  debounced.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }

    pendingArgs = undefined
  }

  debounced.flush = () => {
    const args = pendingArgs

    debounced.cancel()

    if (args) {
      fn(...args)
    }
  }

  return debounced as Debounced<Args>
}
