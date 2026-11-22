import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { SafeMarkdown, TrustedHostsContext, isAllowedHref, toSafeLink } from '../index.js'

const isHoverMe = (element: Element) => {
  return element.textContent === 'hover me'
}

describe('safeMarkdown', () => {
  it('a link survives only as https or mailto', () => {
    expect(isAllowedHref('https://nomadream.ai/x')).toBe(true)
    expect(isAllowedHref('mailto:hi@nomadream.ai')).toBe(true)
    for (const href of ['http://evil.example', 'javascript:alert(1)', 'data:text/html,x', '/relative', undefined]) {
      expect(isAllowedHref(href)).toBe(false)
    }
  })

  it('renders markdown without images, and links only for https or mailto, whatever components a caller passes', async () => {
    const Leak = () => {
      return <img alt="leak" src="https://evil.example/leak" />
    }

    const content = [
      '## Plan',
      'Ready ![](https://evil.example/x?d=1) now.',
      '[Park Hyatt](https://www.hyatt.com/park-hyatt) · [mail us](mailto:hi@nomadream.ai) · [trap](http://evil.example/t)',
    ].join('\n\n')

    const screen = await render(<SafeMarkdown content={content} components={{ img: Leak }} />)

    await expect.element(screen.getByRole('heading', { name: 'Plan' })).toBeVisible()
    await expect.element(screen.getByText('trap')).toBeVisible()
    expect(screen.container.querySelector('img, source, picture')).toBeNull()
    expect(
      [...screen.container.querySelectorAll('a')].map((link) => {
        return link.getAttribute('href')
      }),
    ).toEqual(['https://www.hyatt.com/park-hyatt', 'mailto:hi@nomadream.ai'])
  })

  it('never turns raw HTML in the content into markup, even when a caller asks for it', async () => {
    const probe = vi.fn()

    Object.assign(window, { xssProbe: probe })

    const content = [
      'Before <img src=x onerror="window.xssProbe()"> after.',
      '<script>window.xssProbe()</script>',
      '<iframe src="https://evil.example"></iframe>',
      // No component override touches a span, so it shows whether raw HTML became markup at all.
      '<span onmouseover="window.xssProbe()">hover me</span>',
      'The end.',
    ].join('\n\n')

    const screen = await render(<SafeMarkdown content={content} remarkRehypeOptions={{ allowDangerousHtml: true }} />)

    await expect.element(screen.getByText('The end.')).toBeVisible()
    expect(screen.container.querySelector('img, script, iframe')).toBeNull()
    // Without the guard the span becomes markup (its handler sanitised away); with it only its text stays.
    expect([...screen.container.querySelectorAll('span')].filter(isHoverMe)).toEqual([])
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(probe).not.toHaveBeenCalled()
  })
  // A prompt-injected link carries the conversation out in its path or query; the chains' own links keep theirs.
  it('cuts a link to an unknown host down to its origin, and a mailto loses its prefilled fields', () => {
    expect(toSafeLink('https://evil.example/p?d=secret#frag')).toEqual({
      href: 'https://evil.example/',
      host: 'evil.example',
    })
    expect(toSafeLink('https://evil.example/c2VjcmV0/x')?.href).toBe('https://evil.example/')
    expect(toSafeLink('https://www.hyatt.com/en-US/hotel/x?src=nd#rooms')).toEqual({
      href: 'https://www.hyatt.com/en-US/hotel/x?src=nd#rooms',
      host: 'www.hyatt.com',
    })
    expect(toSafeLink('mailto:hi@nomadream.ai?body=my%20passport&cc=evil@example.com')).toEqual({
      href: 'mailto:hi@nomadream.ai',
    })
    // A lookalike is not the chain: only the domain itself or its subdomains are trusted.
    expect(toSafeLink('https://hyatt.com.evil.example/?d=1')?.href).toBe('https://hyatt.com.evil.example/')
  })

  it("keeps a link to the consumer's own hosts whole and unlabelled, and no host is the consumer's by default", () => {
    expect(toSafeLink('https://nomadream.ai/share/abc?x=1', ['nomadream.ai'])).toEqual({
      href: 'https://nomadream.ai/share/abc?x=1',
    })
    expect(toSafeLink('https://www.nomadream.ai/chat?c=1', ['nomadream.ai'])).toEqual({
      href: 'https://www.nomadream.ai/chat?c=1',
    })
    expect(toSafeLink('https://nomadream.ai.evil.example/?d=1', ['nomadream.ai'])).toEqual({
      href: 'https://nomadream.ai.evil.example/',
      host: 'nomadream.ai.evil.example',
    })
    expect(toSafeLink('https://nomadream.ai/share/abc?x=1')).toEqual({
      href: 'https://nomadream.ai/',
      host: 'nomadream.ai',
    })
  })

  it('takes the own hosts from its prop or from the surrounding TrustedHostsContext', async () => {
    const content = 'See [your chat](https://nomadream.ai/share/abc?x=1).'

    const byProp = await render(<SafeMarkdown content={content} trustedHosts={['nomadream.ai']} />)

    await expect
      .element(byProp.getByRole('link', { name: 'your chat' }))
      .toHaveAttribute('href', 'https://nomadream.ai/share/abc?x=1')
    expect(byProp.container.querySelector('[data-streamdown="link-host"]')).toBeNull()
    await byProp.unmount()

    const byContext = await render(
      <TrustedHostsContext value={['nomadream.ai']}>
        <SafeMarkdown content={content} />
      </TrustedHostsContext>,
    )

    await expect
      .element(byContext.getByRole('link', { name: 'your chat' }))
      .toHaveAttribute('href', 'https://nomadream.ai/share/abc?x=1')
  })

  it('shows where an outside link goes next to its text', async () => {
    const screen = await render(<SafeMarkdown content="Read [the offer](https://evil.example/o?d=1) first." />)

    await expect
      .element(screen.getByRole('link', { name: 'the offer' }))
      .toHaveAttribute('href', 'https://evil.example/')
    await expect.element(screen.getByText('(evil.example)')).toBeVisible()
  })
})
