import { describe, expect, it } from 'vitest'

import { readHeader } from '../headers.js'

describe('readHeader', () => {
  it('matches the name whatever its case', () => {
    expect(readHeader({ 'User-Agent': 'vitest' }, 'user-agent')).toBe('vitest')
    expect(readHeader({ cookie: 'a=1' }, 'Cookie')).toBe('a=1')
  })

  it.each([
    ['no headers', undefined],
    ['null headers', null],
    ['an absent header', { other: 'x' }],
    ['a header without a value', { cookie: undefined }],
  ])('is undefined for %s', (_label, headers) => {
    expect(readHeader(headers, 'cookie')).toBeUndefined()
  })
})
