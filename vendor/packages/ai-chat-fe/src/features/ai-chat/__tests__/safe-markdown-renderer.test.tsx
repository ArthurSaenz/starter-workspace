import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { SafeMarkdownRenderer } from '../components/safe-markdown-renderer.js'

const Leak = () => {
  return <img alt="leak" src="https://evil.example/leak" />
}

const isHoverMe = (element: Element) => {
  return element.textContent === 'hover me'
}

describe('safeMarkdownRenderer', () => {
  it('renders the reply as markdown but never its raw HTML, whatever the caller passes', async () => {
    const probe = vi.fn()

    Object.assign(window, { xssRendererProbe: probe })

    const content = [
      '## Plan',
      'Before <img src=x onerror="window.xssRendererProbe()"> after.',
      '<script>window.xssRendererProbe()</script>',
      // No component override touches a span, so it shows whether raw HTML became markup at all.
      '<span onmouseover="window.xssRendererProbe()">hover me</span>',
      '[trap](javascript:alert(1)) and **bold**.',
    ].join('\n\n')

    const screen = await render(
      <SafeMarkdownRenderer
        content={content}
        components={{ img: Leak }}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
      />,
    )

    await expect.element(screen.getByRole('heading', { name: 'Plan' })).toBeVisible()
    await expect.element(screen.getByText('bold')).toBeVisible()
    // Without the guard the span becomes markup (its handler sanitised away); with it only its text stays.
    expect([...screen.container.querySelectorAll('span')].filter(isHoverMe)).toEqual([])
    expect(screen.container.querySelector('img, script, a, [data-raw-html]')).toBeNull()
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(probe).not.toHaveBeenCalled()
  })
})
