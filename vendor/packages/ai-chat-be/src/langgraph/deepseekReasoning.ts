import { isAIMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

// DeepSeek in thinking mode with `tools` answers 400 unless every earlier assistant turn carries
// its `reasoning_content` back (https://api-docs.deepseek.com/guides/thinking_mode#tool-calls).
// `@langchain/openai`'s message converter drops that field, so it is restored on the wire.

/** One entry per assistant message, in order; `''` where a turn has no recorded reasoning. */
export const assistantReasoningOf = (messages: readonly BaseMessage[]): string[] => {
  return messages.filter(isAIMessage).map((message) => {
    // eslint-disable-next-line dot-notation
    const reasoning = message.additional_kwargs['reasoning_content']

    return typeof reasoning === 'string' ? reasoning : ''
  })
}

interface CompletionsBody {
  messages?: Array<{ role?: unknown; reasoning_content?: string }>
}

// The converter maps each AIMessage to exactly one `assistant` entry, so order is the join key.
export const replayReasoningContent = (body: string, reasoning: readonly string[]): string => {
  let parsed: CompletionsBody

  try {
    parsed = JSON.parse(body) as CompletionsBody
  } catch {
    return body
  }

  if (!Array.isArray(parsed.messages)) return body

  let index = 0

  for (const message of parsed.messages) {
    if (message.role !== 'assistant') continue

    message.reasoning_content = reasoning[index] ?? ''
    index += 1
  }

  return JSON.stringify(parsed)
}

export const fetchWithReasoningReplay = (
  reasoning: readonly string[],
  baseFetch: typeof fetch = fetch,
): typeof fetch => {
  return async (input, init) => {
    if (typeof init?.body !== 'string') return baseFetch(input, init)

    return baseFetch(input, { ...init, body: replayReasoningContent(init.body, reasoning) })
  }
}
