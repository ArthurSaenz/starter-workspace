import { describe, expect, it } from 'vitest'

import { settleBackgroundWrites, trackBackgroundWrite } from '../tools/backgroundWrites.js'

const after = async <T>(ms: number, value: T): Promise<T> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value)
    }, ms)
  })
}

describe('background writes', () => {
  it('settles at once when nothing is pending', async () => {
    expect(await settleBackgroundWrites(10)).toBe('settled')
  })

  it('waits for every tracked write, a failed one included', async () => {
    const done: string[] = []

    trackBackgroundWrite(
      after(20, 'a').then((value) => {
        done.push(value)
      }),
    )
    trackBackgroundWrite(Promise.reject(new Error('db down')))

    expect(await settleBackgroundWrites(1000)).toBe('settled')
    expect(done).toEqual(['a'])
  })

  it('gives up at the cap, and forgets the write once it lands', async () => {
    trackBackgroundWrite(after(60, 'slow'))

    expect(await settleBackgroundWrites(5)).toBe('timed_out')

    await after(80, undefined)

    expect(await settleBackgroundWrites(5)).toBe('settled')
  })
})
