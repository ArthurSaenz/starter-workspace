import { useEffect } from 'react'

import { useAuth, useAuthStore } from '../../../lib/auth-context.js'
import { useLatest } from '../../../lib/use-latest.js'
import { useLogout } from '../../../lib/use-logout.js'
import type { AuthState, RequireAuthContainerProps } from '../types.js'

export const RequireAuthContainer = <TUser,>(props: RequireAuthContainerProps<TUser>) => {
  const { onUnauthenticated, onLoggedOut, fallback, isAllowed, renderDenied, children } = props

  const store = useAuthStore<TUser>()

  const status = useAuth((state: AuthState<TUser>) => {
    return state.status
  })

  const user = useAuth((state: AuthState<TUser>) => {
    return state.user
  })

  const onUnauthenticatedRef = useLatest(onUnauthenticated)

  const onLogout = useLogout(onLoggedOut)

  useEffect(() => {
    if (status === 'unknown') {
      void store.fetchMe()
    } else if (status === 'unauthenticated') {
      onUnauthenticatedRef.current()
    }
  }, [status, store, onUnauthenticatedRef])

  if (status === 'authenticated' && user) {
    // A signed-in user the host does not allow never mounts the protected tree.
    if (isAllowed && !isAllowed(user)) {
      return <>{renderDenied?.({ user, onLogout })}</>
    }

    return <>{children}</>
  }

  return <>{fallback}</>
}
