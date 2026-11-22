import { useAgent } from '@copilotkit/react-core/v2'
import { useEffect } from 'react'

import type { Transcript } from './transcripts.js'

interface SeedTranscriptProps {
  messages: Transcript
}

/**
 * Opens a story on a conversation that already happened, so the state is on screen without a play.
 * Goes in `AIChat`'s `children`. Renders nothing.
 */
export const SeedTranscript = (props: SeedTranscriptProps) => {
  const { messages } = props

  const { agent } = useAgent({ updates: [] })

  useEffect(() => {
    // CopilotChat empties the agent in its own mount effect, which runs after this one (it is a later
    // sibling), so the transcript goes in a task later. A real reopen is `chat.threadId` + `/connect`.
    const timer = setTimeout(() => {
      agent.setMessages(messages)
    })

    return () => {
      clearTimeout(timer)
    }
  }, [agent, messages])

  return null
}
