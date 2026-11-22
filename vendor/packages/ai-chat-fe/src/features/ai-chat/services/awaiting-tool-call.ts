import { useCopilotKit } from '@copilotkit/react-core/v2'

/**
 * True while a frontend tool call is open — for a `useHumanInTheLoop` tool, the whole time its UI
 * waits for `respond()`. CopilotKit's own input only queues an Enter silently behind it (FINDING-4),
 * and any other run orphans the open call, so a composer that must wait for the answer reads this
 * flag. Only valid inside the provider, i.e. in a slot or in `AIChat`'s `children`.
 */
export const useAwaitingToolCall = (): boolean => {
  return useCopilotKit().executingToolCallIds.size > 0
}
