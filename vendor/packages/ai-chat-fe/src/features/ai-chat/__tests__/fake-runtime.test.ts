import { afterEach, describe, expect, it } from 'vitest'

import { AI_CHAT_RUNTIME_URL } from '../../../lib/runtime-url.js'
import {
  TRIP_PLAN_REMOVAL,
  TRIP_PLAN_TO_CONFIRM,
  encodeSse,
  installRuntimeScenario,
  interruptOutcomeFrames,
  partialThenErrorFrames,
  scenarios,
  stateSnapshotFrames,
  thinkingFrames,
  tripPlanFrameBatches,
  tripPlanInterruptFrames,
  tripPlanResumeFrames,
} from './helpers/index.js'
import type { AgUiEvent, FakeRuntime, HttpErrorStatus } from './helpers/index.js'

// Literal bytes copied from vendor/packages/ai-chat-be/src/lambda/copilotkit.ts:40-51 — deliberately NOT
// imported from ./helpers/lambda-bodies.ts, so drift in either copy turns this red.
const LAMBDA_BODY_LITERALS: Record<HttpErrorStatus, string> = {
  401: '{"error":"Sign in to use the assistant.","type":"UNAUTHENTICATED"}',
  404: '{"error":"Not found","type":"NOT_FOUND"}',
  413: '{"error":"The conversation is too long.","type":"PAYLOAD_TOO_LARGE"}',
  429: '{"error":"Slow down a little.","type":"TOO_MANY_REQUESTS"}',
  // copilotkit.ts:42-43 — every runtime 5xx is rewritten to this body.
  500: '{"error":"The assistant is unavailable right now.","type":"INTERNAL_ERROR"}',
  502: '{"error":"The assistant is unavailable right now.","type":"INTERNAL_ERROR"}',
}

const RUN_URL = `${AI_CHAT_RUNTIME_URL}/agent/travelAiAgent/run`
const INFO_URL = `${AI_CHAT_RUNTIME_URL}/info`

// Read at module level, before any install, so it is the same function object the fake captured.
const originalFetch = window.fetch

const postRun = (init: RequestInit = {}) => {
  return fetch(RUN_URL, { method: 'POST', body: '{}', ...init })
}

const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const decodeSse = (sse: string): AgUiEvent[] => {
  return sse
    .split('\n\n')
    .filter(Boolean)
    .map((line) => {
      return JSON.parse(line.slice('data: '.length)) as AgUiEvent
    })
}

describe('installRuntimeScenario', () => {
  const installed: FakeRuntime[] = []

  const install = (...args: Parameters<typeof installRuntimeScenario>) => {
    const runtime = installRuntimeScenario(...args)

    installed.push(runtime)

    return runtime
  }

  afterEach(() => {
    for (const runtime of installed.splice(0)) runtime.restore()

    expect(window.fetch).toBe(originalFetch)
  })

  describe('http bodies are the Lambda bytes', () => {
    it.each([401, 404, 413, 429, 500, 502] as const)('a %s run answers the Lambda body verbatim', async (status) => {
      install({ run: { kind: 'http', status } })

      const response = await postRun()

      expect(response.status).toBe(status)
      expect(await response.text()).toBe(LAMBDA_BODY_LITERALS[status])
    })

    it('a custom body overrides the Lambda one', async () => {
      install({ run: { kind: 'http', status: 500, body: { error: 'custom' } } })

      const response = await postRun()

      expect(response.status).toBe(500)
      expect(await response.text()).toBe('{"error":"custom"}')
    })

    it("info: 'unauthorized' answers /info with the 401 body; 'ok' lists travelAiAgent", async () => {
      install({ info: 'unauthorized' })

      const denied = await fetch(INFO_URL)

      expect(denied.status).toBe(401)
      expect(await denied.text()).toBe(LAMBDA_BODY_LITERALS[401])

      install({})

      const info = await fetch(INFO_URL)

      expect(info.status).toBe(200)
      expect(((await info.json()) as { agents: Record<string, unknown> }).agents).toHaveProperty('travelAiAgent')
    })

    it('a route outside the allow-list is a 404 with the Lambda body', async () => {
      install({})

      const response = await fetch(`${AI_CHAT_RUNTIME_URL}/threads/t1/messages`)

      expect(response.status).toBe(404)
      expect(await response.text()).toBe(LAMBDA_BODY_LITERALS[404])
    })
  })

  describe('partialThenErrorFrames', () => {
    it('is RUN_STARTED, the text frames, then a synthetic RUN_ERROR — in one body', async () => {
      const frames = partialThenErrorFrames('thread-1', 'Bangkok in the rainy season is', 'boom')
      const sse = encodeSse(frames)

      const decoded = sse
        .split('\n\n')
        .filter(Boolean)
        .map((line) => {
          expect(line.startsWith('data: ')).toBe(true)

          return JSON.parse(line.slice('data: '.length)) as { type: string }
        })

      expect(
        decoded.map((frame) => {
          return frame.type
        }),
      ).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_ERROR'])
      // Same shape as `buildRunErrorFrame` (copilotkit.ts:180): type + message, nothing else.
      expect(decoded.at(-1)).toEqual({ type: 'RUN_ERROR', message: 'boom' })

      install({ run: { kind: 'frames', frames } })

      const response = await postRun()

      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(await response.text()).toBe(sse)
    })
  })

  describe('hang', () => {
    it('stays pending until the signal aborts, then rejects with AbortError', async () => {
      install({ run: { kind: 'hang' } })

      const controller = new AbortController()
      const pending = postRun({ signal: controller.signal })

      // Attach the handler now so the rejection below is never "unhandled" between abort and await.
      const outcome = pending.then(
        () => {
          return 'resolved'
        },
        (error: unknown) => {
          return error
        },
      )

      expect(
        await Promise.race([
          outcome,
          sleep(100).then(() => {
            return 'still pending'
          }),
        ]),
      ).toBe('still pending')

      controller.abort()

      const error = await outcome

      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe('AbortError')
    })
  })

  describe('network-error', () => {
    it('rejects the fetch with a TypeError, as the browser does', async () => {
      install({ run: { kind: 'network-error' } })

      await expect(postRun()).rejects.toBeInstanceOf(TypeError)
    })
  })

  describe('install / restore', () => {
    it('the second install in one window wins and either restore returns the original fetch', async () => {
      const first = install({ run: { kind: 'http', status: 401 } })
      const second = install({ run: { kind: 'http', status: 429 } })

      expect((await postRun()).status).toBe(429)
      expect(second.runs).toHaveLength(1)
      expect(first.runs).toHaveLength(0)

      first.restore()

      expect(window.fetch).toBe(originalFetch)

      const third = install({ run: { kind: 'http', status: 413 } })

      second.restore()

      expect(window.fetch).toBe(originalFetch)
      expect(third.runs).toHaveLength(0)
    })
  })

  describe('run resolution', () => {
    it('consumes an array in order and repeats the last entry', async () => {
      const runtime = install({
        run: [
          { kind: 'http', status: 401 },
          { kind: 'reply', text: 'first reply' },
          { kind: 'reply', text: 'second reply' },
        ],
      })

      const bodies: Array<{ status: number; text: string }> = []

      for (let i = 0; i < 4; i += 1) {
        const response = await postRun()

        bodies.push({ status: response.status, text: await response.text() })
      }

      expect(
        bodies.map((body) => {
          return body.status
        }),
      ).toEqual([401, 200, 200, 200])
      expect(bodies[1]?.text).toContain('"delta":"first reply"')
      expect(bodies[2]?.text).toContain('"delta":"second reply"')
      expect(bodies[3]?.text).toContain('"delta":"second reply"')
      expect(runtime.runs).toHaveLength(4)
    })

    it('a resolver receives the run index and the parsed body', async () => {
      const runtime = install({
        run: (runIndex, body) => {
          return { kind: 'reply', text: `run ${runIndex} on ${body.threadId ?? 'no thread'}` }
        },
      })

      const first = await postRun({ body: JSON.stringify({ threadId: 'abc' }) })
      const second = await postRun()

      expect(await first.text()).toContain('"delta":"run 0 on abc"')
      expect(await second.text()).toContain('"delta":"run 1 on no thread"')
      expect(runtime.runs[0]?.body).toEqual({ threadId: 'abc' })
    })

    it('a reply echoes the request threadId and uses a fresh messageId per run', async () => {
      install({ run: { kind: 'reply', text: 'hi' } })

      const first = await (await postRun({ body: JSON.stringify({ threadId: 'abc' }) })).text()
      const second = await (await postRun({ body: JSON.stringify({ threadId: 'abc' }) })).text()

      expect(first).toContain('"threadId":"abc"')
      expect(first).toContain('"messageId":"m1"')
      expect(second).toContain('"messageId":"m2"')
    })
  })

  describe('stop route', () => {
    it('records POST agent/:id/stop/:threadId and answers 200 {} by default', async () => {
      const runtime = install({ run: { kind: 'hang' } })

      const response = await fetch(`${AI_CHAT_RUNTIME_URL}/agent/travelAiAgent/stop/thread-xyz`, { method: 'POST' })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('{}')
      expect(runtime.stops).toEqual([
        { url: `${AI_CHAT_RUNTIME_URL}/agent/travelAiAgent/stop/thread-xyz`, threadId: 'thread-xyz' },
      ])
      expect(runtime.runs).toHaveLength(0)
    })

    it("stop: 'http-500' answers the Lambda 5xx body", async () => {
      install({ stop: 'http-500' })

      const response = await fetch(`${AI_CHAT_RUNTIME_URL}/agent/travelAiAgent/stop/thread-xyz`, { method: 'POST' })

      expect(response.status).toBe(500)
      expect(await response.text()).toBe(LAMBDA_BODY_LITERALS[500])
    })
  })

  // Pins /info to vendor/packages/ai-chat-be/node_modules/@copilotkit/runtime/dist/v2/runtime/handlers/
  // get-runtime-info.mjs for CopilotSseRuntime with no transcriptionService/openGenerativeUI, the
  // `a2ui` option set, and the default InMemoryAgentRunner (ɵsupportsLocalThreadEndpoints === true):
  // suggestions = webEnabled (true, non-Intelligence runtime); audioFileTranscriptionEnabled =
  // false (no transcriptionService); threadEndpoints.list = true (in-memory runner supports local
  // thread endpoints); a2uiEnabled = true and `a2ui: { enabled: true }` (`isA2UIEnabled`);
  // openGenerativeUIEnabled = false (no openGenerativeUI option).
  describe('/info defaults pinned to the real Lambda', () => {
    it('matches get-runtime-info for this deployment', async () => {
      install({})

      const info = (await (await fetch(INFO_URL)).json()) as Record<string, unknown>

      expect(info.suggestions).toBe(true)
      expect(info.audioFileTranscriptionEnabled).toBe(false)
      expect((info.threadEndpoints as { list: boolean }).list).toBe(true)
      expect(info.a2uiEnabled).toBe(true)
      expect(info.a2ui).toEqual({ enabled: true })
      expect(info.openGenerativeUIEnabled).toBe(false)
      // graph/definition.ts AGENT_CAPABILITIES, thinking off — one agent served under both ids.
      expect(info.agents).toMatchObject({
        travelAiAgent: {
          capabilities: {
            reasoning: { supported: true },
            transport: { streaming: true },
            state: { snapshots: true, deltas: true },
          },
        },
        default: {
          capabilities: {
            reasoning: { supported: true },
            transport: { streaming: true },
            state: { snapshots: true, deltas: true },
          },
        },
      })
    })

    it('a per-scenario override changes only that install, never the shared default', async () => {
      install({ info: { overrides: { suggestions: false, audioFileTranscriptionEnabled: true } } })

      const overridden = (await (await fetch(INFO_URL)).json()) as Record<string, unknown>

      expect(overridden.suggestions).toBe(false)
      expect(overridden.audioFileTranscriptionEnabled).toBe(true)

      install({})

      const fresh = (await (await fetch(INFO_URL)).json()) as Record<string, unknown>

      expect(fresh.suggestions).toBe(true)
      expect(fresh.audioFileTranscriptionEnabled).toBe(false)
    })
  })

  describe('requests / denied recording', () => {
    it('records every request the fake sees, allowed and denied, in order', async () => {
      const runtime = install({})

      await fetch(INFO_URL)
      await postRun()
      await fetch(`${AI_CHAT_RUNTIME_URL}/agent/travelAiAgent/stop/thread-xyz`, { method: 'POST' })
      await fetch(`${AI_CHAT_RUNTIME_URL}/threads/t1/messages`)

      expect(
        runtime.requests.map((request) => {
          return request.path
        }),
      ).toEqual(['/info', '/agent/travelAiAgent/run', '/agent/travelAiAgent/stop/thread-xyz', '/threads/t1/messages'])
      expect(runtime.denied).toEqual([expect.objectContaining({ method: 'GET', path: '/threads/t1/messages' })])
    })

    it('a request carries its method, headers and credentials', async () => {
      const runtime = install({})

      await fetch(INFO_URL, { headers: { 'X-Test': 'yes' }, credentials: 'include' })

      expect(runtime.requests).toEqual([
        expect.objectContaining({ method: 'GET', path: '/info', credentials: 'include' }),
      ])
      expect(runtime.requests[0]?.headers['x-test']).toBe('yes')
    })
  })

  // vendor/packages/ai-chat-be/src/transcription/geminiTranscription.ts behind the runtime's handle-transcribe.
  describe('pOST /transcribe', () => {
    const TRANSCRIBE_URL = `${AI_CHAT_RUNTIME_URL}/transcribe`

    const postAudio = () => {
      const form = new FormData()

      form.append('audio', new Blob(['webm bytes'], { type: 'audio/webm;codecs=opus' }), 'recording.webm')

      return fetch(TRANSCRIBE_URL, { method: 'POST', body: form })
    }

    it('without a key: /info says no transcription and the route answers the rewritten 503', async () => {
      const runtime = install({})

      const info = (await (await fetch(INFO_URL)).json()) as Record<string, unknown>
      const response = await postAudio()

      expect(info.audioFileTranscriptionEnabled).toBe(false)
      expect(response.status).toBe(503)
      expect(await response.text()).toBe(LAMBDA_BODY_LITERALS[500])
      expect(runtime.denied).toEqual([])
    })

    it("with a key: /info advertises it and the route answers the runtime's { text, size, type }", async () => {
      const runtime = install({ transcribe: { kind: 'text', text: 'Three weeks in Bangkok.' } })

      const info = (await (await fetch(INFO_URL)).json()) as Record<string, unknown>
      const response = await postAudio()

      expect(info.audioFileTranscriptionEnabled).toBe(true)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        text: 'Three weeks in Bangkok.',
        size: 10,
        type: 'audio/webm;codecs=opus',
      })
      expect(runtime.transcribes).toEqual([
        { url: TRANSCRIBE_URL, audio: expect.objectContaining({ name: 'recording.webm', size: 10 }) },
      ])
    })

    it('an error status answers the Lambda body for it, or the body given verbatim', async () => {
      install({ transcribe: { kind: 'http', status: 429 } })

      const throttled = await postAudio()

      expect(throttled.status).toBe(429)
      expect(await throttled.text()).toBe(LAMBDA_BODY_LITERALS[429])

      // Through the scenario, so the helpers' TRANSCRIPTION_RATE_LIMITED_BODY is pinned to the literal.
      install(scenarios.voiceRateLimited)

      const rateLimited = await postAudio()

      expect(rateLimited.status).toBe(429)
      expect(await rateLimited.text()).toBe(
        '{"error":"rate_limited","message":"Rate limited. Please try again later.","retryable":true}',
      )
    })
  })

  // The Lambda's own allow-list (vendor/packages/ai-chat-be/src/lambda/copilotkit.ts isAllowedRoute)
  // reaches GET .../info and .../threads, POST .../agent/:id/run|suggest|connect|stop/:threadId and
  // .../transcribe; the per-thread routes and the thread mutations stay 404.
  describe('routes off the allow-list', () => {
    it.each(['/suggest', '/connect', '/threads/t1/messages', '/threads/clear'])(
      '%s answers 404 with the Lambda NOT_FOUND body',
      async (route) => {
        const runtime = install({})

        const response = await fetch(`${AI_CHAT_RUNTIME_URL}${route}`)

        expect(response.status).toBe(404)
        expect(await response.text()).toBe(LAMBDA_BODY_LITERALS[404])
        expect(runtime.denied).toEqual([expect.objectContaining({ path: route })])
      },
    )
  })

  // vendor/packages/ai-chat-be `CustomerChatsRunner`: what a connect replays and what the list holds.
  describe('kept threads', () => {
    const CONNECT_URL = `${AI_CHAT_RUNTIME_URL}/agent/travelAiAgent/connect`

    const KEPT = {
      id: 'kept-1',
      name: 'Hotels in Bangkok?',
      messages: [
        { id: 'u1', role: 'user', content: 'Hotels in Bangkok?' },
        { id: 'a1', role: 'assistant', content: 'Try the Park Hyatt.' },
      ],
      state: { tripPlan: TRIP_PLAN_TO_CONFIRM },
      interrupts: [{ id: 'run-1~abc', reason: 'confirm_trip_plan_change', message: 'Remove it?' }],
      updatedAt: '2026-10-01T10:00:00.000Z',
    }

    const connect = async (threadId: string) => {
      const response = await fetch(CONNECT_URL, { method: 'POST', body: JSON.stringify({ threadId }) })

      return { status: response.status, frames: decodeSse(await response.text()) }
    }

    it('replays a kept thread on connect: transcript, state and the open interrupts', async () => {
      const runtime = install({ threads: [KEPT] })

      const { status, frames } = await connect('kept-1')

      expect(status).toBe(200)
      expect(
        frames.map((frame) => {
          return frame.type
        }),
      ).toEqual(['RUN_STARTED', 'MESSAGES_SNAPSHOT', 'STATE_SNAPSHOT', 'RUN_FINISHED'])
      expect(frames[1]).toMatchObject({ messages: KEPT.messages })
      expect(frames[3]).toMatchObject({ outcome: { type: 'interrupt', interrupts: KEPT.interrupts } })
      expect(runtime.connects).toEqual([{ url: CONNECT_URL, threadId: 'kept-1' }])
    })

    it('replays nothing for a thread it does not keep', async () => {
      install({ threads: [KEPT] })

      expect(await connect('unknown')).toEqual({ status: 200, frames: [] })
    })

    it('lists the kept threads newest first, and keeps a reply run under its thread', async () => {
      install({ threads: [KEPT], run: { kind: 'reply', text: 'Sure.' } })

      await postRun({
        body: JSON.stringify({ threadId: 'fresh', messages: [{ id: 'u9', role: 'user', content: 'Newer question' }] }),
      })

      const response = await fetch(`${AI_CHAT_RUNTIME_URL}/threads?agentId=travelAiAgent`)

      const { threads, nextCursor } = (await response.json()) as {
        threads: Array<{ id: string; name: string; agentId: string }>
        nextCursor: null
      }

      expect(nextCursor).toBeNull()
      expect(
        threads.map((thread) => {
          return [thread.id, thread.name, thread.agentId]
        }),
      ).toEqual([
        ['fresh', 'Newer question', 'travelAiAgent'],
        ['kept-1', 'Hotels in Bangkok?', 'travelAiAgent'],
      ])
      expect((await connect('fresh')).frames[1]).toMatchObject({
        messages: [
          expect.objectContaining({ content: 'Newer question' }),
          expect.objectContaining({ content: 'Sure.' }),
        ],
      })
    })
  })

  describe('new frame builders encode to valid SSE', () => {
    it('tripPlanFrameBatches', () => {
      const hotel = { hotelId: 'h-1', name: 'Park Hyatt Bangkok', chain: 'hyatt', area: 'ploenchit', stars: 5 }

      const decoded = decodeSse(
        encodeSse(tripPlanFrameBatches({ destination: 'Bangkok', hotels: [hotel], replyText: 'done' }).flat()),
      )

      const args = decoded
        .filter((frame) => {
          return frame.type === 'TOOL_CALL_ARGS'
        })
        .map((frame) => {
          return frame.delta
        })
        .join('')

      const plans = decoded
        .filter((frame) => {
          return frame.type === 'STATE_DELTA'
        })
        .map((frame) => {
          return (frame.delta as Array<{ value: unknown }>)[0]?.value
        })

      // The chunks join into the arguments `applyTripPlanUpdate` parses.
      expect(JSON.parse(args)).toEqual({ destination: 'Bangkok', addHotels: [{ hotelId: 'h-1', name: hotel.name }] })
      expect(decoded[1]).toMatchObject({ type: 'STATE_SNAPSHOT', snapshot: { tripPlan: { hotels: [] } } })
      expect(plans).toEqual([
        { destination: 'Bangkok', nights: null, hotels: [], programmes: [] },
        {
          destination: 'Bangkok',
          nights: null,
          hotels: [{ hotelId: 'h-1', name: hotel.name, chain: null, area: null, stars: null, pending: true }],
          programmes: [],
        },
        { destination: 'Bangkok', nights: null, hotels: [hotel], programmes: [] },
      ])
      expect(decoded.at(-1)?.type).toBe('RUN_FINISHED')
    })

    it('stateSnapshotFrames', () => {
      const decoded = decodeSse(encodeSse(stateSnapshotFrames('thread-1', { nights: 21 })))

      expect(
        decoded.map((frame) => {
          return frame.type
        }),
      ).toEqual(['RUN_STARTED', 'STATE_SNAPSHOT', 'RUN_FINISHED'])
      expect(decoded[1]).toMatchObject({ snapshot: { nights: 21 } })
    })

    it('thinkingFrames', () => {
      const decoded = decodeSse(encodeSse(thinkingFrames('thread-1', 'weighing options', 'here is the answer')))

      expect(
        decoded.map((frame) => {
          return frame.type
        }),
      ).toEqual([
        'RUN_STARTED',
        'REASONING_START',
        'REASONING_MESSAGE_START',
        'REASONING_MESSAGE_CONTENT',
        'REASONING_MESSAGE_END',
        'REASONING_END',
        'TEXT_MESSAGE_START',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_END',
        'RUN_FINISHED',
      ])
      expect(decoded[3]).toMatchObject({ delta: 'weighing options' })
    })

    it('interruptOutcomeFrames', () => {
      const decoded = decodeSse(encodeSse(interruptOutcomeFrames('thread-1', [{ id: 'i1', reason: 'confirm_budget' }])))

      expect(
        decoded.map((frame) => {
          return frame.type
        }),
      ).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
      expect(decoded[1]).toMatchObject({
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'confirm_budget' }] },
      })
    })

    // The shape `InProcessAgent.readInterrupts` and `findTripPlanConfirmation` produce
    // (vendor/packages/ai-chat-be/src/__tests__/inProcessAgent.interrupts.test.ts).
    it('tripPlanInterruptFrames ends on one RUN_FINISHED carrying the confirmation, after the streamed call', () => {
      const frames = tripPlanInterruptFrames({ runId: 'run-7', plan: TRIP_PLAN_TO_CONFIRM, change: TRIP_PLAN_REMOVAL })

      expect(
        frames.map((frame) => {
          return frame.type
        }),
      ).toEqual(['RUN_STARTED', 'STATE_SNAPSHOT', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'RUN_FINISHED'])
      expect(frames.at(-1)).toMatchObject({
        runId: 'run-7',
        outcome: {
          type: 'interrupt',
          interrupts: [
            {
              id: expect.stringMatching(/^run-7~[0-9a-f]{32}$/),
              reason: 'confirm_trip_plan_change',
              message: 'The assistant wants to remove Park Hyatt Bangkok in your trip plan. Allow it?',
              expiresAt: expect.any(String),
              metadata: {
                kind: 'confirm_trip_plan_change',
                removals: {
                  hotels: [{ hotelId: 'hotel-park-hyatt-bangkok', name: 'Park Hyatt Bangkok' }],
                  programmes: [],
                },
                changes: {},
              },
            },
          ],
        },
      })
    })

    it('tripPlanResumeFrames applies the change only on approval', () => {
      const input = { plan: TRIP_PLAN_TO_CONFIRM, change: TRIP_PLAN_REMOVAL, replyText: 'ok' }
      const approved = tripPlanResumeFrames({ ...input, approved: true })
      const declined = tripPlanResumeFrames({ ...input, approved: false })

      expect(
        approved.find((frame) => {
          return frame.type === 'STATE_DELTA'
        }),
      ).toMatchObject({
        delta: [{ op: 'replace', path: '/tripPlan', value: { hotels: [{ hotelId: 'hotel-jw-marriott-bangkok' }] } }],
      })
      expect(
        declined.some((frame) => {
          return frame.type === 'STATE_DELTA'
        }),
      ).toBe(false)
      expect(
        declined.find((frame) => {
          return frame.type === 'TOOL_CALL_RESULT'
        })?.content,
      ).toContain('declined')
    })
  })
})
