import { describe, expect, it } from 'vitest'

import { buildMagicLinkUrl, escapeHtml, renderMagicLinkEmail } from '../email.js'

const TEXT = { subject: 'Sign in', intro: 'Use the link below:', linkLabel: 'Sign in' }

describe('buildMagicLinkUrl', () => {
  it.each([
    [undefined, 'https://app.test/auth/verify?token=abc'],
    ['/', 'https://app.test/auth/verify?token=abc'],
    ['/x', 'https://app.test/auth/verify?token=abc&redirect=%2Fx'],
  ])('redirect %j → %s', (redirectUrl, expected) => {
    expect(buildMagicLinkUrl('https://app.test', 'abc', redirectUrl)).toBe(expected)
  })
})

describe('escapeHtml', () => {
  it.each([
    ['plain', 'plain'],
    ['a & b', 'a &amp; b'],
    ['<b>x</b>', '&lt;b&gt;x&lt;/b&gt;'],
    [`"q" 'q'`, '&quot;q&quot; &#39;q&#39;'],
  ])('%j → %j', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected)
  })
})

describe('renderMagicLinkEmail', () => {
  it('escapes the copy in the html part only', () => {
    const email = renderMagicLinkEmail('ada@example.com', 'https://app.test/v?token=abc', 15, {
      ...TEXT,
      intro: '<b>x</b>',
    })

    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(email.text).toContain('<b>x</b>')
  })

  it("escapes the default warning's apostrophe in html and keeps it in text", () => {
    const email = renderMagicLinkEmail('ada@example.com', 'https://app.test/v?token=abc', 15, TEXT)

    expect(email.html).toContain('didn&#39;t')
    expect(email.text).toContain("didn't")
  })
})
