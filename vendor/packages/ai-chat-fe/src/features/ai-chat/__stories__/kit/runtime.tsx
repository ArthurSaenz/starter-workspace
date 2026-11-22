import { useEffect, useState } from 'react'

import type { FakeRequest, FakeRuntime } from '../../__tests__/helpers/index.js'

interface WireLogProps {
  runtime: FakeRuntime
  runtimeUrl: string
  /** A request header to show on every entry, e.g. one set through `provider.headers`. */
  header?: string
}

/**
 * The requests the chat sent to the story's stand-in runtime, listed above the chat so the wire
 * (URL, agent, credentials, a header) is on screen. Goes in `AIChat`'s `children`.
 */
export const WireLog = (props: WireLogProps) => {
  const { runtime, runtimeUrl, header } = props

  const [requests, setRequests] = useState<readonly FakeRequest[]>([])

  useEffect(() => {
    // The fake records into a plain array that nothing observes, so the log samples it.
    const timer = setInterval(() => {
      setRequests((current) => {
        return current.length === runtime.requests.length ? current : [...runtime.requests]
      })
    }, 200)

    return () => {
      clearInterval(timer)
    }
  }, [runtime])

  return (
    <div className="border-b bg-slate-50 p-3 font-mono text-xs text-slate-700" data-testid="wire-log">
      <p className="mb-1 font-sans font-semibold">Requests the chat sent</p>
      <ol className="space-y-0.5">
        {requests.map((request, index) => {
          return (
            // eslint-disable-next-line react/no-array-index-key -- the log only grows; the same request can repeat
            <li key={index}>
              {request.method} {runtimeUrl}
              {request.path} · credentials: {request.credentials ?? 'unset'}
              {header ? ` · ${header}: ${request.headers[header] ?? '—'}` : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
