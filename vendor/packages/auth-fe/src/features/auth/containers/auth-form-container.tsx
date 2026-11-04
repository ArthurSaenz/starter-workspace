import { useEffect } from 'react'

import { useAuth, useAuthStore } from '../../../lib/auth-context.js'
import { useLatest } from '../../../lib/use-latest.js'
import { safeRedirect } from '../services/libs.js'
import type { AuthFormContainerProps } from '../types.js'

export const AuthFormContainer = (props: AuthFormContainerProps) => {
  const { redirect, onAuthenticated, render } = props

  const store = useAuthStore<unknown>()

  const state = useAuth<unknown>()

  const onAuthenticatedRef = useLatest(onAuthenticated)

  // Resolve an undetermined session, and hand an already-authenticated visitor back to the host.
  useEffect(() => {
    if (state.status === 'unknown') {
      void store.fetchMe()
    } else if (state.status === 'authenticated') {
      onAuthenticatedRef.current(safeRedirect(redirect))
    }
  }, [state.status, store, redirect, onAuthenticatedRef])

  return render({
    status: state.status,
    loading: state.requestLoading,
    sentToEmail: state.sentToEmail,
    error: state.requestError,
    onSubmit: (values) => {
      return store.submitEmail({ email: values.email, redirectUrl: safeRedirect(redirect) })
    },
    onUseDifferentEmail: store.resetSentEmail,
  })
}
