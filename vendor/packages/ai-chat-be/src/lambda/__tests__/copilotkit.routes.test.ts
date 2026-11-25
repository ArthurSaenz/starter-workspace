import { describe, expect, it } from 'vitest'

import { isAllowedRoute } from '../copilotkit.js'

const ROOT = '/v1/ai/copilotkit'

// The runtime's routes (`@copilotkit/runtime` v2 `fetch-router`) that know no caller, so the
// Lambda must never forward them: the per-thread reads and mutations, the debug feed that streams
// every thread, and the memory routes. A runtime bump that adds a route lands here as a rejection
// until it is let through on purpose.
const REJECTED: [method: string, path: string][] = [
  ['GET', `${ROOT}/threads/t-1/messages`],
  ['GET', `${ROOT}/threads/t-1/events`],
  ['GET', `${ROOT}/threads/t-1/state`],
  ['GET', `${ROOT}/threads/subscribe`],
  ['POST', `${ROOT}/threads/clear`],
  ['POST', `${ROOT}/threads/t-1/archive`],
  ['POST', `${ROOT}/threads/t-1`],
  ['PATCH', `${ROOT}/threads/t-1`],
  ['DELETE', `${ROOT}/threads/t-1`],
  ['POST', `${ROOT}/threads`],
  ['GET', `${ROOT}/cpk-debug-events`],
  ['GET', `${ROOT}/inspector-metadata`],
  ['GET', `${ROOT}/inspector-learning`],
  ['GET', `${ROOT}/memories`],
  ['POST', `${ROOT}/memories/recall`],
  ['POST', `${ROOT}/memories/m-1`],
  ['POST', `${ROOT}/annotate`],
  ['GET', `${ROOT}/trajectory/tr-1/connect`],
  ['POST', `${ROOT}/trajectory/tr-1/connect`],
  ['GET', `${ROOT}/agent/travelAiAgent/connect`],
  ['GET', `${ROOT}/agent/travelAiAgent/run`],
  ['PUT', `${ROOT}/agent/travelAiAgent/run`],
  ['POST', `${ROOT}/info`],
  ['POST', `${ROOT}/agent/travelAiAgent/transcribe`],
]

// What react-core and the Lambda's own `feedback` actually call.
const ALLOWED: [method: string, path: string][] = [
  ['OPTIONS', `${ROOT}/threads/clear`],
  ['GET', `${ROOT}/info`],
  ['GET', `${ROOT}/threads`],
  ['POST', `${ROOT}/agent/travelAiAgent/run`],
  ['POST', `${ROOT}/agent/travelAiAgent/suggest`],
  ['POST', `${ROOT}/agent/travelAiAgent/connect`],
  ['POST', `${ROOT}/agent/travelAiAgent/stop/t-1`],
  ['POST', `${ROOT}/transcribe`],
  ['POST', `${ROOT}/feedback`],
]

describe('isAllowedRoute', () => {
  it.each(REJECTED)('rejects %s %s', (method, path) => {
    expect(isAllowedRoute(path, method)).toBe(false)
  })

  it.each(ALLOWED)('allows %s %s', (method, path) => {
    expect(isAllowedRoute(path, method)).toBe(true)
  })
})
