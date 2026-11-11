import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const isBrowser = typeof window !== 'undefined'

// Mount points this hook created, with how many mounted hooks use each; one found in the page is never removed.
const createdNodeUsers = new WeakMap<Element, number>()

export const usePortal = (id: string) => {
  const portalRef = useRef(isBrowser ? getPortalNode(id) : null)

  useEffect(() => {
    const node = portalRef.current

    if (!node || !createdNodeUsers.has(node)) return

    createdNodeUsers.set(node, createdNodeUsers.get(node)! + 1)

    // StrictMode's replayed effect, or a remount, finds the node already removed by the last cleanup.
    if (!node.isConnected) document.body.appendChild(node)

    return () => {
      const users = createdNodeUsers.get(node)! - 1

      createdNodeUsers.set(node, users)

      if (users === 0) node.remove()
    }
  }, [])

  const Portal = useCallback(({ children }: { children: React.ReactNode }): React.ReactPortal | null => {
    return portalRef.current && createPortal(children, portalRef.current)
  }, [])

  return Object.assign([Portal, portalRef], {
    Portal,
    portalRef,
  })
}

/**
 * Returns or creates a DOM element to be used as a portal mount point.
 *
 * @example
 *     const node = getPortalNode('modal-root')
 */
const getPortalNode = (id: string): Element => {
  let node = document.querySelector(`#${id}`)

  if (!node) {
    const element = document.createElement('div')

    element.setAttribute('id', id)
    document.body.appendChild(element)
    createdNodeUsers.set(element, 0)

    node = element
  }

  return node
}
