import { describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import { useControllableState } from '../core/use-controllable-state'

const append = (item: string) => {
  return (previous: string[]) => {
    return [...previous, item]
  }
}

describe('useControllableState', () => {
  it('applies every updater of one batch to uncontrolled state', async () => {
    const onChange = vi.fn()

    const hook = await renderHook(() => {
      return useControllableState<string[]>({ initial: [], onChange })
    })

    await hook.act(() => {
      const [, setState] = hook.result.current

      setState(append('a'))
      setState(append('b'))
    })

    expect(hook.result.current[0]).toEqual(['a', 'b'])
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b'])
  })

  it('resolves an updater against the consumer value while controlled', async () => {
    const onChange = vi.fn()

    const hook = await renderHook(() => {
      return useControllableState<string[]>({ value: ['x'], initial: [], onChange })
    })

    await hook.act(() => {
      hook.result.current[1](append('a'))
      // The consumer has not accepted 'a', so the next updater must not build on it.
      hook.result.current[1](append('b'))
    })

    expect(onChange.mock.calls).toEqual([[['x', 'a']], [['x', 'b']]])
    expect(hook.result.current[0]).toEqual(['x'])
  })
})
