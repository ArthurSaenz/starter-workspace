import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { Script } from '..'

let counter = 0

const okSrc = () => {
  counter += 1

  return `data:text/javascript,void ${counter}`
}

const brokenSrc = () => {
  counter += 1

  return `/__missing__/script-${counter}.js`
}

const scriptsWith = (src: string) => {
  return [...document.scripts].filter((script) => {
    return script.getAttribute('src') === src
  })
}

const idle = () => {
  return new Promise<void>((resolve) => {
    requestIdleCallback(() => {
      setTimeout(resolve, 50)
    })
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('script', () => {
  it('injects a remote script with its attributes and reports load then ready', async () => {
    const src = okSrc()
    const onLoad = vi.fn()
    const onReady = vi.fn()

    await render(<Script src={src} id="remote-attrs" className="tracked" onLoad={onLoad} onReady={onReady} />)

    await expect
      .poll(() => {
        return onReady.mock.calls.length
      })
      .toBe(1)
    expect(onLoad).toHaveBeenCalledOnce()

    const element = document.getElementById('remote-attrs')!

    expect(element.getAttribute('src')).toBe(src)
    expect(element.getAttribute('class')).toBe('tracked')
  })

  it('loads a shared src once and tells every component when it is ready', async () => {
    const src = okSrc()
    const first = vi.fn()
    const second = vi.fn()
    const secondLoad = vi.fn()

    await render(
      <>
        <Script src={src} onReady={first} />
        <Script src={src} id="shared-second" onReady={second} onLoad={secondLoad} />
      </>,
    )

    await expect
      .poll(() => {
        return second.mock.calls.length
      })
      .toBe(1)
    expect(first).toHaveBeenCalledOnce()
    expect(secondLoad).toHaveBeenCalledOnce()
    expect(scriptsWith(src)).toHaveLength(1)
  })

  it('reports a failed shared load as an error to every component', async () => {
    const src = brokenSrc()
    const onLoad = vi.fn()
    const firstError = vi.fn()
    const secondError = vi.fn()

    await render(
      <>
        <Script src={src} onError={firstError} />
        <Script src={src} id="broken-second" onError={secondError} onLoad={onLoad} />
        <Script src={src} id="broken-silent" />
      </>,
    )

    await expect
      .poll(() => {
        return secondError.mock.calls.length
      })
      .toBe(1)
    expect(firstError).toHaveBeenCalledOnce()
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('retries a failed load on the next mount of the same src', async () => {
    const src = brokenSrc()
    const firstError = vi.fn()
    const retryError = vi.fn()

    const screen = await render(<Script src={src} onError={firstError} />)

    await expect
      .poll(() => {
        return firstError.mock.calls.length
      })
      .toBe(1)
    expect(scriptsWith(src)).toHaveLength(0)

    await screen.unmount()
    await render(<Script src={src} onError={retryError} />)

    expect(scriptsWith(src)).toHaveLength(1)
    await expect
      .poll(() => {
        return retryError.mock.calls.length
      })
      .toBe(1)
    expect(scriptsWith(src)).toHaveLength(0)
  })

  it('runs an inline script and calls onReady again on a later mount', async () => {
    const onReady = vi.fn()

    const screen = await render(
      <Script id="inline-children" onReady={onReady}>
        window.__inlineChildren = 1
      </Script>,
    )

    expect(document.getElementById('inline-children')!.textContent).toBe('window.__inlineChildren = 1')
    expect(onReady).toHaveBeenCalledOnce()

    await screen.unmount()
    await render(<Script id="inline-children" onReady={onReady} />)

    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('runs inline HTML and joined children', async () => {
    await render(
      <>
        <Script id="inline-html" dangerouslySetInnerHTML={{ __html: 'window.__inlineHtml = 1' }} />
        <Script id="inline-array">{['window.__a', ' = 1']}</Script>
      </>,
    )

    expect(document.getElementById('inline-html')!.innerHTML).toBe('window.__inlineHtml = 1')
    expect(document.getElementById('inline-array')!.textContent).toBe('window.__a = 1')
  })

  it('removes its script on unmount, found by src when there is no id', async () => {
    const src = okSrc()
    const onUnMount = vi.fn()
    const onReady = vi.fn()

    const screen = await render(<Script src={src} shouldUnMountScript onUnMount={onUnMount} onReady={onReady} />)

    await expect
      .poll(() => {
        return onReady.mock.calls.length
      })
      .toBe(1)
    await screen.unmount()

    expect(scriptsWith(src)).toHaveLength(0)
    expect(onUnMount).toHaveBeenCalledOnce()
  })

  it('removes its script by an id that is not a valid CSS selector', async () => {
    const screen = await render(
      <Script id="1-numeric.id" shouldUnMountScript>
        void 0
      </Script>,
    )

    await screen.unmount()

    expect(document.getElementById('1-numeric.id')).toBeNull()
  })

  it('loads a lazy script once the browser is idle', async () => {
    const src = okSrc()
    const onReady = vi.fn()

    await render(<Script src={src} strategy="lazyOnload" onReady={onReady} />)

    await expect
      .poll(() => {
        return onReady.mock.calls.length
      })
      .toBe(1)
  })

  it('waits for the page load event before a lazy load', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')

    const src = okSrc()

    await render(<Script src={src} strategy="lazyOnload" />)
    await idle()
    expect(scriptsWith(src)).toHaveLength(0)

    window.dispatchEvent(new Event('load'))
    await expect
      .poll(() => {
        return scriptsWith(src)
      })
      .toHaveLength(1)
  })

  it('never injects a lazy script whose component unmounted before it loaded', async () => {
    const src = okSrc()
    const screen = await render(<Script src={src} strategy="lazyOnload" shouldUnMountScript />)

    await screen.unmount()
    await idle()

    expect(scriptsWith(src)).toHaveLength(0)
  })

  it('drops the pending page-load listener of an unmounted lazy script', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')

    const src = okSrc()
    const screen = await render(<Script src={src} strategy="lazyOnload" shouldUnMountScript />)

    await screen.unmount()
    window.dispatchEvent(new Event('load'))
    await idle()

    expect(scriptsWith(src)).toHaveLength(0)
  })
})
