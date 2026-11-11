import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const isBrowser = typeof window !== 'undefined'

// Mount points this hook created, with how many mounted hooks use each; one found in the page is never removed.
const createdNodeUsers = new WeakMap<Element, number>()
// Created but not yet attached: lets same-id hooks in one render share a node before any effect appends it.
const detachedNodes = new Map<string, Element>()

export const usePortal = (id: string) => {
  const [node] = useState(() => {
    return isBrowser ? getPortalNode(id) : null
  })

  const portalRef = useRef(node)

  useEffect(() => {
    const node = portalRef.current

    if (!node || !createdNodeUsers.has(node)) return

    createdNodeUsers.set(node, createdNodeUsers.get(node)! + 1)

    // StrictMode's replayed effect, or a remount, finds the node already removed by the last cleanup.
    if (!node.isConnected) document.body.appendChild(node)

    detachedNodes.delete(node.id)

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
 * Returns the page's element with `id`, or a detached one that the first committed effect appends: a render that
 * never commits leaves nothing in the page.
 *
 * @example
 *     const node = getPortalNode('modal-root')
 */
const getPortalNode = (id: string): Element => {
  const existing = document.getElementById(id) ?? detachedNodes.get(id)

  if (existing) return existing

  const element = document.createElement('div')

  element.setAttribute('id', id)
  createdNodeUsers.set(element, 0)
  detachedNodes.set(id, element)

  return element
}
