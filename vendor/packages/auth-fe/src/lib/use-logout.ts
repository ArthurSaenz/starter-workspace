import { useAuthStore } from './auth-context.js'

/**
 * The `onLogout` the session containers hand to the host's markup: ends the session, then awaits
 * the host's `onLoggedOut`.
 *
 * @example
 *     const onLogout = useLogout(onLoggedOut)
 */
export const useLogout = (onLoggedOut: () => void | Promise<void>) => {
  const store = useAuthStore<unknown>()

  return async (): Promise<void> => {
    await store.logout()
    await onLoggedOut()
  }
}
