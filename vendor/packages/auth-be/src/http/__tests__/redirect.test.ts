import { describe, expect, it } from 'vitest'

import { hasUnsafeRedirectChars, sanitizeRedirectUrl } from '../redirect.js'

describe('sanitizeRedirectUrl', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/trips?x=1', '/trips?x=1'],
    ['trips', '/trips'],
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/a\nb', '/'],
    [`/${'a'.repeat(2048)}`, '/'],
    ['/.//evil.com', '/'],
    ['/..//evil.com', '/'],
    ['.//evil.com', '/'],
    ['/a/../..//evil.com', '/'],
    ['/%2e%2e//evil.com', '/'],
    ['/a/./b', '/a/./b'],
    ['/trips?next=//evil.com', '/trips?next=//evil.com'],
    [42, '/'],
    [{}, '/'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeRedirectUrl(input)).toBe(expected)
  })
})

describe('hasUnsafeRedirectChars', () => {
  it.each([
    ['/trips', false],
    ['/a?b=c#d', false],
    ['/\\evil.com', true],
    ['/a\u0000', true],
    ['/a\nb', true],
    ['/a\u007F', true],
  ])('%j → %s', (input, unsafe) => {
    expect(hasUnsafeRedirectChars(input)).toBe(unsafe)
  })
})
