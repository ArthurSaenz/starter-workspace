// Duplicated from vendor/packages/ai-chat-be/src/lambda/copilotkit.ts:40-51 — the bodies are un-exported
// `const`s in a Node-only package, so they cannot be imported here. Stored as the same
// `JSON.stringify(...)` expressions so the bytes on the wire match; `../fake-runtime.test.ts`
// pins them against literal strings so drift in either file shows up as a red test.
export const NOT_FOUND_BODY = JSON.stringify({ error: 'Not found', type: 'NOT_FOUND' })
export const UNAUTHORIZED_BODY = JSON.stringify({ error: 'Sign in to use the assistant.', type: 'UNAUTHENTICATED' })
export const PAYLOAD_TOO_LARGE_BODY = JSON.stringify({
  error: 'The conversation is too long.',
  type: 'PAYLOAD_TOO_LARGE',
})
export const TOO_MANY_REQUESTS_BODY = JSON.stringify({ error: 'Slow down a little.', type: 'TOO_MANY_REQUESTS' })

// copilotkit.ts:42-43 — every runtime 5xx reaches the traveller as this body; the raw
// provider text stays in the Lambda logs.
export const GENERIC_ERROR_BODY = JSON.stringify({
  error: 'The assistant is unavailable right now.',
  type: 'INTERNAL_ERROR',
})

// vendor/packages/ai-chat-be/src/copilotkit/inProcessAgent.ts:12 — the message carried by the
// RUN_ERROR frame the browser renders when the graph throws.
export const RUN_ERROR_MESSAGE = 'The assistant could not answer that. Please try again.'
// The watchdog's synthetic RUN_ERROR after a partial answer — vendor/packages/ai-chat-be/src/lambda/copilotkit.ts:310.
export const RUN_TIMEOUT_MESSAGE = 'The assistant took too long to respond.'

// `POST /transcribe` when Gemini rate-limits: the runtime's own `TranscriptionErrors.rateLimited()`
// (@copilotkit/shared 1.90.0 `transcription-errors.mjs`), reached by geminiTranscription.ts's
// "Too many requests" message. A 4xx, so the Lambda passes it through — a 5xx it would rewrite to
// GENERIC_ERROR_BODY.
export const TRANSCRIPTION_RATE_LIMITED_BODY = JSON.stringify({
  error: 'rate_limited',
  message: 'Rate limited. Please try again later.',
  retryable: true,
})
