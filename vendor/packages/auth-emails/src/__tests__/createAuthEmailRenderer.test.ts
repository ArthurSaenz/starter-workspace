import { describe, expect, it } from 'vitest'

import { createAuthEmailRenderer } from '../createAuthEmailRenderer.js'

const LINK = 'https://app.test/auth/verify?token=abc123&redirect=%2Ftrips'

describe('createAuthEmailRenderer', () => {
  it('renders the sign-in template to HTML and plain text', async () => {
    const renderEmail = createAuthEmailRenderer({ brand: { name: 'Acme', primaryColor: '#ff5a00' } })

    const email = await renderEmail({ to: 'ada@example.com', link: LINK, expMin: 15, kind: 'sign-in' })

    expect(email.to).toBe('ada@example.com')
    expect(email.subject).toBe('Your sign-in link')
    expect(email.html).toMatch(/^<!DOCTYPE html/i)
    expect(email.html).toContain('href="https://app.test/auth/verify?token=abc123&amp;redirect=%2Ftrips"')
    expect(email.html).toContain('background-color:#ff5a00')
    expect(email.text).toContain(LINK)
    expect(email.text).toContain('This link expires in 15 minutes.')
    expect(email.text).not.toContain('<')
  })

  it('uses the invite copy and its own expiry wording', async () => {
    const renderEmail = createAuthEmailRenderer({ brand: { name: 'Acme' } })

    const email = await renderEmail({ to: 'new@example.com', link: LINK, expMin: 72 * 60, kind: 'invite' })

    expect(email.subject).toBe("You've been invited")
    expect(email.text).toContain('This invite expires in 3 days.')
  })

  it('merges per-kind copy overrides over the defaults', async () => {
    const renderEmail = createAuthEmailRenderer({
      brand: { name: 'Acme' },
      copy: { 'sign-in': { subject: 'Вхід до Acme', buttonLabel: 'Увійти' } },
    })

    const email = await renderEmail({ to: 'ada@example.com', link: LINK, expMin: 15, kind: 'sign-in' })

    expect(email.subject).toBe('Вхід до Acme')
    expect(email.html).toContain('Увійти')
    expect(email.text).toContain('This link expires in 15 minutes.')
  })

  it('keeps the default for an override that is explicitly undefined', async () => {
    const renderEmail = createAuthEmailRenderer({
      brand: { name: 'Acme' },
      copy: { 'sign-in': { subject: undefined as unknown as string, buttonLabel: 'Go' } },
    })

    const email = await renderEmail({ to: 'ada@example.com', link: LINK, expMin: 15, kind: 'sign-in' })

    expect(email.subject).toBe('Your sign-in link')
    expect(email.html).toContain('Go')
  })

  it('escapes copy instead of injecting it as markup', async () => {
    const renderEmail = createAuthEmailRenderer({
      brand: { name: 'Acme' },
      copy: { 'sign-in': { intro: '<script>alert(1)</script>' } },
    })

    const { html } = await renderEmail({ to: 'ada@example.com', link: LINK, expMin: 15, kind: 'sign-in' })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('shows the brand logo only when one is configured', async () => {
    const withLogo = createAuthEmailRenderer({ brand: { name: 'Acme', logoUrl: 'https://cdn.test/logo.png' } })
    const withoutLogo = createAuthEmailRenderer({ brand: { name: 'Acme' } })
    const input = { to: 'ada@example.com', link: LINK, expMin: 15, kind: 'sign-in' } as const

    expect((await withLogo(input)).html).toContain('src="https://cdn.test/logo.png"')
    expect((await withoutLogo(input)).html).not.toContain('<img')
  })

  it('sets the html and body lang, English by default', async () => {
    const input = { to: 'ada@example.com', link: LINK, expMin: 15, kind: 'sign-in' } as const
    const he = (await createAuthEmailRenderer({ brand: { name: 'Acme' }, lang: 'he' })(input)).html
    const en = (await createAuthEmailRenderer({ brand: { name: 'Acme' } })(input)).html

    // react-email writes `dir` before `lang`, so the tag reads `<html dir="ltr" lang="…"`.
    expect(he).toMatch(/<html [^>]*lang="he"/)
    expect(he).toMatch(/<body [^>]*lang="he"/)
    expect(en).toMatch(/<html [^>]*lang="en"/)
  })
})
