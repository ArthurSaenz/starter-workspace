import type { OnChangeFn, Updater } from '@tanstack/react-table'
import { useCallback, useState } from 'react'

import { useLatestRef } from './use-latest-ref'

export interface ControllableStateOptions<TState> {
  /** Present (even as an empty object/array) means the consumer owns the state. */
  value?: TState
  onChange?: OnChangeFn<TState>
  /** Seeds the internal state on first render only; ignored while controlled. */
  initial: TState
}

/**
 * One piece of table state that a consumer may or may not own.
 *
 * The returned setter is a TanStack `OnChangeFn`, so it accepts either a value or an updater
 * function and is handed straight to `useTable`. Its identity never changes, which keeps
 * the table options stable across renders. `onChange` is always called with a resolved value —
 * a consumer storing sorting in Jotai should not have to unwrap an updater.
 */
export const useControllableState = <TState>(
  options: ControllableStateOptions<TState>,
): [TState, OnChangeFn<TState>] => {
  const { value, onChange, initial } = options

  const [internalState, setInternalState] = useState<TState>(initial)

  const isControlled = value !== undefined
  const state = isControlled ? value : internalState

  const isControlledRef = useLatestRef(isControlled)
  const stateRef = useLatestRef(state)
  const onChangeRef = useLatestRef(onChange)

  const handleChange = useCallback<OnChangeFn<TState>>((updaterOrValue: Updater<TState>) => {
    const next =
      typeof updaterOrValue === 'function'
        ? (updaterOrValue as (previous: TState) => TState)(stateRef.current)
        : updaterOrValue

    if (!isControlledRef.current) {
      setInternalState(next)
    }

    onChangeRef.current?.(next)
    // Every dependency is read through a latest-ref, so the callback is intentionally stable.
  }, [])

  return [state, handleChange]
}
