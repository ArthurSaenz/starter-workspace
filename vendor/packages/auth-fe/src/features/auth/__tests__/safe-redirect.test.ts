import { describe, expect, it } from 'vitest'

import { safeRedirect } from '../services/libs.js'

describe('safeRedirect', () => {
  it('passes through an in-app relative path', () => {
    expect(safeRedirect('/chat/123')).toBe('/chat/123')
    expect(safeRedirect('/connectors/123')).toBe('/connectors/123')
  })

  it('falls back to / for protocol-relative, absolute, and missing values', () => {
    expect(safeRedirect('//evil.com')).toBe('/')
    expect(safeRedirect('https://evil.com')).toBe('/')
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect('')).toBe('/')
  })

  it('refuses backslashes and control characters', () => {
    expect(safeRedirect('/\\evil.com')).toBe('/')
    expect(safeRedirect('/\tevil.com')).toBe('/')
    expect(safeRedirect('/a\u0000b')).toBe('/')
    expect(safeRedirect('/a\u007Fb')).toBe('/')
  })

  it('refuses a colon anywhere and a path longer than 2048 characters', () => {
    expect(safeRedirect('/a:b')).toBe('/')
    expect(safeRedirect(`/${'x'.repeat(2048)}`)).toBe('/')
    expect(safeRedirect(`/${'x'.repeat(2047)}`)).toBe(`/${'x'.repeat(2047)}`)
  })

  it.each(['/.//evil.com', '/..//evil.com', '/a/../..//evil.com', '/%2e%2e//evil.com'])(
    'refuses %j, whose dot segments resolve to a protocol-relative //evil.com',
    (input) => {
      expect(safeRedirect(input)).toBe('/')
    },
  )

  it('keeps dot segments that stay a path, and a // inside the query', () => {
    expect(safeRedirect('/a/./b')).toBe('/a/./b')
    expect(safeRedirect('/trips?next=//evil.com')).toBe('/trips?next=//evil.com')
  })

  it.each([42, {}, null])('falls back to / for a non-string %j from an untyped response body', (input) => {
    expect(safeRedirect(input)).toBe('/')
  })

  it.each(['//evil.com', '/\\evil.com', '/a\u0000', 'javascript:x', 'https://e.com'])(
    'refuses %j like the backend sanitiser does',
    (input) => {
      expect(safeRedirect(input)).toBe('/')
    },
  )
})
