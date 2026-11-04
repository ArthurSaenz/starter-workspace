import { useEffect, useState } from 'react'

import { useAuthStore } from '../../../lib/auth-context.js'
import { useLatest } from '../../../lib/use-latest.js'
import { safeRedirect } from '../services/libs.js'
import type { AuthVerifyContainerProps, AuthVerifyState } from '../types.js'

export const AuthVerifyContainer = (props: AuthVerifyContainerProps) => {
  const { token, redirect, onVerified, render } = props

  const store = useAuthStore<unknown>()

  const [state, setState] = useState<AuthVerifyState>('idle')

  const onVerifiedRef = useLatest(onVerified)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!token) {
        setState('error')

        return
      }

      setState('loading')

      const result = await store.verify(token)

      if (cancelled) return

      if (!result.ok || !store.getState().user) {
        setState('error')

        return
      }

      onVerifiedRef.current(safeRedirect(result.redirect ?? redirect))
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [token, redirect, store, onVerifiedRef])

  return render(state)
}
