import type { ChatFailure, ChatFailureEvent, ChatFailureText } from '../types.js'

// What the traveller reads when a turn fails. CopilotKit v2 renders nothing on its own — without
// a handler the failure only reaches console.error — so this is the whole error UI.
export const describeChatFailure = (event: ChatFailureEvent, text?: ChatFailureText): ChatFailure => {
  const { code, error } = event
  const copy = { ...T, ...text }

  const named = describeNamedFailure(event, copy)

  if (named) return named

  // A RUN_ERROR frame carries the Lambda's own traveller-facing sentence (inProcessAgent's
  // generic text or the watchdog's "took too long"), so it is shown as-is unless re-worded.
  if (code === 'agent_run_error_event' && error.message) {
    return { kind: 'run-error', text: text?.['run-error'] ?? error.message }
  }

  // Before any run: the runtime handshake failed, so the input is dead until a reload.
  if (code === 'runtime_info_fetch_failed') return { kind: 'offline', text: copy.offline }

  const status = readHttpStatus(error)

  if (status === 401) return { kind: 'session-expired', text: copy['session-expired'] }
  if (status === 413) return { kind: 'too-long', text: copy['too-long'] }
  if (status === 429) {
    // The daily quota answers 429 too, but waiting a minute will not lift it: the body's `type` says which.
    if (error.message.includes(DAILY_QUOTA_EXCEEDED)) return { kind: 'quota-exceeded', text: copy['quota-exceeded'] }

    return { kind: 'throttled', text: copy.throttled }
  }

  // The quota store could not be read: a blip on our side, so the same turn can simply run again.
  if (status === 503 && error.message.includes(QUOTA_UNAVAILABLE)) {
    return { kind: 'quota-unavailable', text: copy['quota-unavailable'] }
  }

  return { kind: 'unavailable', text: copy.unavailable }
}

// The failures the server or CopilotKit name outright, whatever their HTTP status.
const describeNamedFailure = (event: ChatFailureEvent, copy: typeof T & ChatFailureText): ChatFailure | undefined => {
  const { code, error } = event

  if (isConversationNotKept(error)) return { kind: 'not-kept', text: copy['not-kept'] }
  if (hasCode(error, CONVERSATION_CHANGED)) return { kind: 'conversation-changed', text: copy['conversation-changed'] }
  // Voice input failing is not a failed turn: the conversation is untouched and the traveller can type.
  if (code.startsWith(TRANSCRIPTION_CODE_PREFIX)) {
    return {
      kind: 'transcription-failed',
      text: isBudgetExhausted(error) ? copy['transcription-budget'] : copy['transcription-failed'],
    }
  }

  if (isBudgetExhausted(error)) return { kind: 'budget-exhausted', text: copy['budget-exhausted'] }
  if (hasCode(error, SERVICE_UNAVAILABLE)) return { kind: 'service-unavailable', text: copy['service-unavailable'] }
  if (hasCode(error, THREAD_RUNNING)) return { kind: 'thread-running', text: copy['thread-running'] }

  return undefined
}

// The server no longer holds a transcript it can continue from. CopilotKit copies a RUN_ERROR's
// `code` onto the error it reports, but a runtime that sends only `message` must map the same way.
const CONVERSATION_NOT_KEPT = 'CONVERSATION_NOT_KEPT'

// The same chat is answering in another tab or window; the server refuses a second run until it ends.
const THREAD_RUNNING = 'THREAD_RUNNING'

// CopilotKit's `transcription_failed`, `transcription_network_error`, … — every voice-input failure.
const TRANSCRIPTION_CODE_PREFIX = 'transcription_'

// Another tab kept a turn of this chat first, so this tab's transcript is behind the server's.
const CONVERSATION_CHANGED = 'CONVERSATION_CHANGED'

// `ai-chat-be`'s daily-quota 429 body type, and its 503 when the quota store cannot be read.
const DAILY_QUOTA_EXCEEDED = 'DAILY_QUOTA_EXCEEDED'
const QUOTA_UNAVAILABLE = 'QUOTA_UNAVAILABLE'

// The service's own daily spend ran out (503): nothing the traveller does lifts it before tomorrow. It
// can arrive as the HTTP body's `type` or as a RUN_ERROR `code`, depending on where the run was refused.
const SERVICE_BUDGET_EXHAUSTED = 'SERVICE_BUDGET_EXHAUSTED'

// The model provider refused the service's account (e.g. its credit ran out): an outage only an operator
// ends, of unknown length — unlike the budget, it is not over at midnight.
const SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'

const isBudgetExhausted = (error: Error): boolean => {
  return (
    hasCode(error, SERVICE_BUDGET_EXHAUSTED) ||
    (readHttpStatus(error) === 503 && error.message.includes(SERVICE_BUDGET_EXHAUSTED))
  )
}

const hasCode = (error: Error, code: string): boolean => {
  return (error as Error & { code?: unknown }).code === code || error.message === code
}

const isConversationNotKept = (error: Error): boolean => {
  return hasCode(error, CONVERSATION_NOT_KEPT)
}

// @ag-ui/client's fetch wrapper throws `Error("HTTP <status>: <body>")` with `.status` attached.
const readHttpStatus = (error: Error): number | undefined => {
  const status = (error as Error & { status?: unknown }).status

  return typeof status === 'number' ? status : undefined
}

const T = {
  'session-expired': 'Your session has expired — sign in again to continue.',
  throttled: 'Too many requests — give it a minute and try again.',
  'quota-exceeded': "You've reached today's assistant limit. It resets at midnight UTC.",
  'too-long': 'This conversation got too long — start a new one.',
  'not-kept': "This conversation can't continue. Start a new chat.",
  'conversation-changed': 'This chat changed in another tab.',
  'quota-unavailable': 'The assistant is briefly unavailable. Try again.',
  'budget-exhausted': "The assistant has reached today's limit. Please try again tomorrow.",
  'service-unavailable': 'The assistant is temporarily unavailable. Please try again later.',
  'thread-running': 'This chat is already answering in another tab.',
  'transcription-failed': 'Voice input did not work this time. Try again, or type your question.',
  'transcription-budget': "Voice input has reached today's limit. Type your question instead.",
  unavailable: 'The assistant is unavailable right now. Please try again.',
  offline: 'The assistant is unavailable right now. Reload the page to try again.',
}
