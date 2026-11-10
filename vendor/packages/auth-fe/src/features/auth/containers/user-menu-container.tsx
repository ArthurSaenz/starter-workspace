import { useAuth } from '../../../lib/auth-context.js'
import { useLogout } from '../../../lib/use-logout.js'
import type { AuthState, UserMenuContainerProps } from '../types.js'

export const UserMenuContainer = <TUser,>(props: UserMenuContainerProps<TUser>) => {
  const { onLoggedOut, render } = props

  const onLogout = useLogout(onLoggedOut)

  const status = useAuth((state: AuthState<TUser>) => {
    return state.status
  })

  const user = useAuth((state: AuthState<TUser>) => {
    return state.user
  })

  if (status !== 'authenticated' || !user) return null

  return render({ user, onLogout })
}
