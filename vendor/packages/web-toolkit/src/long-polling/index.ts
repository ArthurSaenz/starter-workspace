export interface PollArgs<T> {
  fn: () => Promise<T>
  condition: (result: T) => boolean
  intervalMs: number
  maxAttempts?: number
  firstDelayMs?: number
  /** Stops polling: the returned promise rejects with `signal.reason` at the next wait, or once the running attempt settles. */
  signal?: AbortSignal
}

/**
 * Polls an async function at a fixed interval until a condition is no longer met or the attempt limit is reached.
 *
 * @example
 *     const result = await poll({
 *         fn: () => fetchStatus(jobId),
 *         condition: (res) => res.status === 'pending',
 *         intervalMs: 2000,
 *         maxAttempts: 10,
 *         signal: controller.signal,
 *     })
 */
export const poll = async <T>(args: PollArgs<T>): Promise<T> => {
  const { fn, condition, intervalMs, maxAttempts = 10, firstDelayMs = 0, signal } = args

  if (firstDelayMs > 0) {
    await wait(firstDelayMs, signal)
  }

  signal?.throwIfAborted()

  let result = await fn()
  let attempts = 0

  signal?.throwIfAborted()

  while (condition(result) && attempts < maxAttempts) {
    await wait(intervalMs, signal)
    attempts++
    result = await fn()
    signal?.throwIfAborted()
  }

  return result
}

/** Resolves after `ms`, or rejects with `signal.reason` as soon as the signal aborts. */
export const wait = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()

    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
