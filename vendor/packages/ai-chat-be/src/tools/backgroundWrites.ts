// Writes a run starts without awaiting (the usage counter), so the answer never waits on them. Lambda
// freezes the sandbox once the handler returns, and a write still in flight then lands on the next thaw
// or never: the handler settles them after the response has ended. One invocation runs at a time per
// container, so a module-level set holds only the current invocation's writes.
const pending = new Set<Promise<unknown>>()

/** Registers a write the handler must let finish before the invocation ends; never rejects. */
export const trackBackgroundWrite = (write: Promise<unknown>): void => {
  const settled = write.then(
    () => {
      return undefined
    },
    () => {
      return undefined
    },
  )

  pending.add(settled)
  void settled.finally(() => {
    pending.delete(settled)
  })
}

/** Waits for every tracked write, but no longer than `capMs`: a stuck database must not hold the bill. */
export const settleBackgroundWrites = async (capMs: number): Promise<'settled' | 'timed_out'> => {
  if (pending.size === 0) return 'settled'

  let timer: ReturnType<typeof setTimeout> | undefined

  const cap = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timed_out')
    }, capMs)
  })

  try {
    return await Promise.race([
      Promise.allSettled([...pending]).then(() => {
        return 'settled' as const
      }),
      cap,
    ])
  } finally {
    clearTimeout(timer)
  }
}
