import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import { useEffect, useRef } from 'react'

interface StartRunProps {
  /** Sent as the traveller's message; the story's runtime scenario decides what comes back. */
  message: string
  /** The agent state the browser holds before the run — e.g. a trip plan an earlier turn built. */
  state?: Record<string, unknown>
}

/**
 * Opens a story on a turn that is already under way — a reply streaming, a stop button, an error
 * line — without a play typing it. Goes in `AIChat`'s `children`. Renders nothing.
 */
export const StartRun = (props: StartRunProps) => {
  const { message, state } = props

  const { agent } = useAgent({ updates: [] })
  const { copilotkit } = useCopilotKit()

  const startedRef = useRef(false)

  useEffect(() => {
    // Before `/info` lands the agent is a placeholder that is replaced on connect (re-running this
    // effect), and a run on it never reaches the chat.
    if (startedRef.current || copilotkit.runtimeConnectionStatus !== 'connected') return

    // A task later for the same reason as SeedTranscript: CopilotChat empties the agent on mount.
    const timer = setTimeout(() => {
      startedRef.current = true
      if (state) agent.setState(state)
      agent.addMessage({ id: 'start-run-user', role: 'user', content: message })
      copilotkit.runAgent({ agent }).catch(() => {
        // A failing scenario is the state some stories show; the chat's own error line reports it.
      })
    })

    return () => {
      clearTimeout(timer)
    }
  }, [agent, copilotkit, message, state])

  return null
}
