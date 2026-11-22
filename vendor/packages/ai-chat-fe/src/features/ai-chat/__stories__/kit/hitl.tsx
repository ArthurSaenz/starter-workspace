import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import { useEffect, useRef } from 'react'

import { useAwaitingToolCall } from '../../services/main.js'

export const TALK_PAST_MESSAGE = 'actually, what about Chiang Mai?'

/**
 * Sends one more message once a human-in-the-loop prompt is waiting for its answer — what a traveller
 * does when they type instead of answering. Goes in `AIChat`'s `children`. Renders nothing.
 */
export const TalkPastPrompt = () => {
  const { agent } = useAgent({ updates: [] })
  const { copilotkit } = useCopilotKit()
  const promptOpen = useAwaitingToolCall()

  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current || !promptOpen) return

    sentRef.current = true
    agent.addMessage({ id: 'talk-past-user', role: 'user', content: TALK_PAST_MESSAGE })
    copilotkit.runAgent({ agent }).catch(() => {
      // A failing scenario would show on the chat's own error line.
    })
  }, [agent, copilotkit, promptOpen])

  return null
}
