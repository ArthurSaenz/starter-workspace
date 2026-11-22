import { useEffect, useState } from 'react'

import type { FakeRuntime } from '../../__tests__/helpers/index.js'

interface A2uiActionLogProps {
  runtime: FakeRuntime
}

/**
 * The A2UI button clicks the chat sent, one line per run that carried `forwardedProps.a2uiAction`
 * (action name, surface and context), shown above the chat. Goes in `AIChat`'s `children`.
 */
export const A2uiActionLog = (props: A2uiActionLogProps) => {
  const { runtime } = props

  const [actions, setActions] = useState<readonly string[]>([])

  useEffect(() => {
    // The fake records into a plain array that nothing observes, so the log samples it.
    const timer = setInterval(() => {
      const next = runtime.runs.flatMap((run) => {
        const action = run.body.forwardedProps?.a2uiAction

        return action === undefined ? [] : [JSON.stringify(action)]
      })

      setActions((current) => {
        return current.length === next.length ? current : next
      })
    }, 200)

    return () => {
      clearInterval(timer)
    }
  }, [runtime])

  return (
    <div className="border-b bg-slate-50 p-3 font-mono text-xs text-slate-700" data-testid="a2ui-action-log">
      <p className="mb-1 font-sans font-semibold">forwardedProps.a2uiAction the chat sent</p>
      {actions.length === 0 ? <p className="font-sans">None yet: press “Add to trip plan” on a card.</p> : null}
      <ol className="space-y-0.5">
        {actions.map((action, index) => {
          return (
            // eslint-disable-next-line react/no-array-index-key -- the log only grows; the same click can repeat
            <li key={index}>{action}</li>
          )
        })}
      </ol>
    </div>
  )
}
