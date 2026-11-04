import { AuthContext } from '../../../lib/auth-context.js'
import type { AuthProviderContainerProps } from '../types.js'

export const AuthProviderContainer = <TUser,>(props: AuthProviderContainerProps<TUser>) => {
  const { store, children } = props

  return <AuthContext value={store as AuthProviderContainerProps<unknown>['store']}>{children}</AuthContext>
}

// The original name; consumers still import it.
export const AuthProvider = AuthProviderContainer
