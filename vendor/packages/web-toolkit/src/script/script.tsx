import { useEffect, useRef } from 'react'

import { cancelIdleCallback, requestIdleCallback } from './request-idle-callback'

type ScriptProps = React.ScriptHTMLAttributes<HTMLScriptElement> & {
  strategy?: 'afterInteractive' | 'lazyOnload'
  id?: string
  onLoad?: (e: any) => void
  onReady?: () => void | null
  onError?: (e: any) => void
  children?: React.ReactNode
  shouldUnMountScript?: boolean
  onUnMount?: () => void
}

/**
 * Injects a `<script>` element into the document with strategy-controlled timing and load callbacks.
 *
 * @example
 *     <Script src="https://cdn.example.com/lib.js" strategy="lazyOnload" onReady={() => initLib()} />
 */
export const Script = (props: ScriptProps): React.ReactElement | null => {
  const { id, src = '', onReady = null, strategy = 'afterInteractive', shouldUnMountScript, onUnMount } = props

  // Survives StrictMode's effect replay, so onReady for an already-loaded script fires once per mount.
  const hasOnReadyEffectCalled = useRef(false)

  useEffect(() => {
    const cacheKey = id || src

    if (!hasOnReadyEffectCalled.current) {
      // Run onReady if script has loaded before but component is re-mounted
      if (onReady && cacheKey && LoadCache.has(cacheKey)) {
        onReady()
      }

      hasOnReadyEffectCalled.current = true
    }
  }, [onReady, id, src])

  useEffect(() => {
    if (strategy === 'afterInteractive') {
      loadScript(props)
    }

    const cancelLazyLoad = strategy === 'lazyOnload' ? loadLazyScript(props) : undefined

    if (shouldUnMountScript) {
      return () => {
        cancelLazyLoad?.()
        removeScript(props)
        onUnMount?.()
      }
    }
  }, [])

  return null
}

Object.defineProperty(Script, '__customScript', { value: true })

const ScriptCache = new Map<string | undefined, Promise<void>>()
const LoadCache = new Set<string | undefined>()

const DOMAttributeNames: Record<string, string> = {
  acceptCharset: 'accept-charset',
  className: 'class',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
  noModule: 'noModule',
}

const ignoreProps = [
  'onLoad',
  'onReady',
  'dangerouslySetInnerHTML',
  'children',
  'onError',
  'strategy',
  'shouldUnMountScript',
  'onUnMount',
]

/**
 * Creates and appends a `<script>` DOM element, deduplicating by cache key and wiring load/error callbacks.
 *
 * @example
 *     loadScript({ src: 'https://cdn.example.com/lib.js', id: 'my-lib', onLoad: () => console.log('loaded') })
 */
const loadScript = (props: ScriptProps): void => {
  const { src, id, onLoad = () => {}, onReady = null, dangerouslySetInnerHTML, children = '', onError } = props

  const cacheKey = id || src

  // Script has already loaded
  if (cacheKey && LoadCache.has(cacheKey)) {
    return
  }

  // Contents of this script are already loading/loaded
  const pendingLoad = ScriptCache.get(src)

  if (pendingLoad) {
    // Same remote script for several components: it loads once, every component still gets its own callbacks.
    pendingLoad.then(
      () => {
        LoadCache.add(cacheKey)
        onLoad(undefined)
        onReady?.()
      },
      (error: unknown) => {
        onError?.(error)
      },
    )

    return
  }

  /**
   * Execute after the script first loaded.
   *
   * @example
   *     afterLoad()
   */
  const afterLoad = () => {
    if (onReady) {
      onReady()
    }

    LoadCache.add(cacheKey)
  }

  const element = document.createElement('script')

  // Kept rejecting on error, so components that share this load see the failure too.
  const loadPromise = new Promise<void>((resolve, reject) => {
    element.addEventListener('load', function (e) {
      resolve()

      onLoad.call(this, e)

      afterLoad()
    })

    element.addEventListener('error', (e) => {
      reject(e)
    })
  })

  loadPromise.catch((error: unknown) => {
    onError?.(error)
  })

  if (dangerouslySetInnerHTML) {
    element.innerHTML = dangerouslySetInnerHTML.__html.toString() || ''

    afterLoad()
  } else if (children) {
    // eslint-disable-next-line sonarjs/no-nested-conditional -- flat enough to read inline
    element.textContent = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : ''

    afterLoad()
  } else if (src) {
    element.src = src
    // do not add cacheKey into LoadCache for remote script here
    // cacheKey will be added to LoadCache when it is actually loaded (see loadPromise above)

    ScriptCache.set(src, loadPromise)
  }

  for (const [k, value] of Object.entries(props)) {
    if (value === undefined || ignoreProps.includes(k)) {
      continue
    }

    const attr = DOMAttributeNames[k] || k.toLowerCase()

    element.setAttribute(attr, value)
  }

  document.body.appendChild(element)
}

function loadLazyScript(props: ScriptProps): () => void {
  let idleCallbackId: number | undefined

  const scheduleLoad = () => {
    idleCallbackId = requestIdleCallback(() => {
      loadScript(props)
    })
  }

  if (document.readyState === 'complete') {
    scheduleLoad()
  } else {
    window.addEventListener('load', scheduleLoad, { once: true })
  }

  return () => {
    window.removeEventListener('load', scheduleLoad)

    if (idleCallbackId !== undefined) {
      cancelIdleCallback(idleCallbackId)
    }
  }
}

function removeScript(props: ScriptProps) {
  const { src, id } = props

  const cacheKey = id || src

  const element = id
    ? document.getElementById(id)
    : [...document.scripts].find((script) => {
        return script.getAttribute('src') === src
      })

  element?.remove()

  ScriptCache.delete(src)
  LoadCache.delete(cacheKey)
}
