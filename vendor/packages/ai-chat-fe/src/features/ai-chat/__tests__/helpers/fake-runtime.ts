import { AI_CHAT_RUNTIME_URL } from '../../../../lib/runtime-url.js'
import { encodeSse, replyFrames, toolCallFrames } from './frames.js'
import type { AgUiEvent } from './frames.js'
import {
  GENERIC_ERROR_BODY,
  NOT_FOUND_BODY,
  PAYLOAD_TOO_LARGE_BODY,
  TOO_MANY_REQUESTS_BODY,
  UNAUTHORIZED_BODY,
} from './lambda-bodies.js'

export type HttpErrorStatus = 401 | 404 | 413 | 429 | 500 | 502

export type RunScenario =
  | { kind: 'reply'; text: string; delayMs?: number }
  | { kind: 'frames'; frames: AgUiEvent[]; delayMs?: number }
  /** The reply in `words`, one TEXT_MESSAGE_CONTENT frame per word, `gapMs` apart — the streamed ingress. */
  | { kind: 'streamed'; words: string[]; gapMs: number }
  /** Each batch of frames flushed `gapMs` after the previous one — a streamed run of any shape. */
  | { kind: 'paced'; batches: AgUiEvent[][]; gapMs: number }
  | { kind: 'http'; status: HttpErrorStatus; body?: unknown }
  | { kind: 'network-error' }
  | { kind: 'hang' }

export interface RunBody {
  threadId?: string
  runId?: string
  messages?: Array<{
    id?: string
    role: string
    content?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
  }>
  tools?: Array<{ name: string }>
  context?: Array<{ description: string; value: string }>
  /** The browser's shared state (`agent.setState()`), which the Lambda echoes as the run's STATE_SNAPSHOT. */
  state?: Record<string, unknown>
  forwardedProps?: Record<string, unknown>
  /** The answers to the last run's interrupts, as `useInterrupt`'s `resolve()` / `cancel()` send them. */
  resume?: Array<{ interruptId: string; status: 'resolved' | 'cancelled'; payload?: unknown }>
}

export type RunResolver = (runIndex: number, body: RunBody) => RunScenario

/**
 * What `POST /transcribe` answers: the runtime's `{ text, size, type }`, or an error status with the
 * Lambda's body for it (`body` overrides — e.g. TRANSCRIPTION_RATE_LIMITED_BODY, the provider's own).
 */
export type TranscribeScenario =
  { kind: 'text'; text: string; delayMs?: number } | { kind: 'http'; status: HttpErrorStatus; body?: unknown }

/**
 * A conversation the Lambda keeps in `customer_chats` (vendor/packages/ai-chat-be `CustomerChatsRunner`):
 * `agent/:id/connect` replays it, `GET /threads` lists it. A `reply` run on a thread keeps it too.
 */
export interface KeptThread {
  id: string
  name: string
  /** The AG-UI transcript as the agent holds it; opaque to the fake, replayed as is. */
  messages: readonly unknown[]
  state?: Record<string, unknown>
  /** The open interrupts its last run paused on, replayed on the RUN_FINISHED of a connect. */
  interrupts?: unknown[]
  updatedAt?: string
}

export interface RuntimeScenario {
  /**
   * `{ overrides }` patches the default INFO per-scenario only — the default itself never changes.
   * `unauthorized-once` answers 401 to the first GET `/info` only: a handshake that failed once.
   * `fails-after-handshake` answers the first and fails every later one, as a cold Lambda fails
   * CopilotKit's reachability probe while a run is still in flight.
   */
  info?: 'ok' | 'unauthorized' | 'unauthorized-once' | 'fails-after-handshake' | { overrides: Partial<typeof INFO> }
  /** An array is consumed in order and its last entry repeats. */
  run?: RunScenario | RunScenario[] | RunResolver
  stop?: 'ok' | 'http-500'
  /** What `agent/:id/suggest` answers, as the forced `copilotkitSuggest` call's arguments. */
  suggestions?: Array<{ title: string; message: string }>
  /**
   * Set = the Lambda has GEMINI_API_KEY: `/info` advertises `audioFileTranscriptionEnabled: true`
   * (unless `info.overrides` says otherwise) and `POST /transcribe` answers with this. Unset = no
   * key: the flag is false and the runtime's 503 reaches the browser as GENERIC_ERROR_BODY.
   */
  transcribe?: TranscribeScenario
  /** The traveller's kept conversations; none by default, so a connect replays nothing. */
  threads?: readonly KeptThread[]
}

export const DEFAULT_GENERATED_SUGGESTIONS = [
  { title: 'Hilton on a long stay', message: 'How does Hilton Honors Diamond compare on a long stay?' },
  { title: 'Bangkok hotels', message: 'Which Bangkok hotels are on Marriott Bonvoy?' },
]

export interface RunRequest {
  url: string
  credentials: RequestCredentials | undefined
  body: RunBody
}

export interface StopRequest {
  url: string
  threadId: string
}

export interface ConnectRequest {
  url: string
  threadId: string | undefined
}

export interface TranscribeRequest {
  url: string
  /** The multipart `audio` field react-core posts (`recording.webm`); undefined when it sent none. */
  audio: File | undefined
}

// Every request the fake's `fetch` override sees for AI_CHAT_RUNTIME_URL, allowed or not —
// `path` is the route stripped of AI_CHAT_RUNTIME_URL (e.g. `/info`, `/threads`).
export interface FakeRequest {
  method: string
  path: string
  headers: Record<string, string>
  credentials: RequestCredentials | undefined
}

export interface FakeRuntime {
  runs: RunRequest[]
  /** The suggestion engine's runs; kept apart so `runs` counts the traveller's turns only. */
  suggests: RunRequest[]
  stops: StopRequest[]
  transcribes: TranscribeRequest[]
  connects: ConnectRequest[]
  /** The server's kept conversations by id: the scenario's `threads` plus every `reply` run's thread. */
  threads: Map<string, KeptThread>
  /** Every request the fake handled, in order — a superset of `runs`/`stops`/`transcribes`/`denied`. */
  requests: FakeRequest[]
  /** The subset of `requests` that fell off the allow-list and got the Lambda's 404 body. */
  denied: FakeRequest[]
  restore: () => void
}

const DEFAULT_RUN: RunScenario = { kind: 'reply', text: 'Happy to help — what are you planning?' }

const LAMBDA_BODIES: Record<HttpErrorStatus, string> = {
  401: UNAUTHORIZED_BODY,
  404: NOT_FOUND_BODY,
  413: PAYLOAD_TOO_LARGE_BODY,
  429: TOO_MANY_REQUESTS_BODY,
  500: GENERIC_ERROR_BODY,
  502: GENERIC_ERROR_BODY,
}

// packages/ai-travel-agent/src/graph/definition.ts `AGENT_CAPABILITIES` with the Lambda's default
// LANGGRAPH_THINKING_BUDGET=0 (reasoning off). The Lambda serves one agent under both ids.
export const AGENT_CAPABILITIES = {
  identity: {
    name: 'travelAiAgent',
    description: 'NomaDream travel assistant: hotel loyalty programmes and the hotel catalogue.',
  },
  transport: { streaming: true },
  tools: { supported: true, clientProvided: true, parallelCalls: true },
  reasoning: { supported: true, streaming: true },
  state: { snapshots: true, deltas: true },
  humanInTheLoop: { supported: true, approvals: true },
}

const INFO = {
  version: '1.90.0',
  agents: {
    travelAiAgent: {
      name: 'travelAiAgent',
      description: '',
      className: 'InProcessAgent',
      capabilities: AGENT_CAPABILITIES,
    },
    default: { name: 'default', description: '', className: 'InProcessAgent', capabilities: AGENT_CAPABILITIES },
  },
  audioFileTranscriptionEnabled: false,
  mode: 'sse',
  threadEndpoints: { list: true, inspect: true, mutations: false, realtimeMetadata: false },
  suggestions: true,
  // The Lambda passes `a2ui` to its runtime (vendor/packages/ai-chat-be `A2UI_RUNTIME_OPTIONS`) and leaves
  // `openGenerativeUI` out (owner decision).
  a2uiEnabled: true,
  a2ui: { enabled: true },
  openGenerativeUIEnabled: false,
  telemetryDisabled: true,
}

const RUN_ROUTE = /^\/agent\/[^/]+\/run$/
const CONNECT_ROUTE = /^\/agent\/[^/]+\/connect$/
const THREADS_ROUTE = '/threads'
// vendor/packages/ai-chat-be `THREAD_ORGANIZATION_ID`.
const THREAD_ORGANIZATION_ID = 'nomadream'
const SUGGEST_ROUTE = /^\/agent\/[^/]+\/suggest$/
const STOP_ROUTE = /^\/agent\/[^/]+\/stop\/([^/]+)$/
const TRANSCRIBE_ROUTE = '/transcribe'

// Captured unbound at module load so `restore()` puts back the very same function object
// (identity is what the tests assert). Every install overwrites `window.fetch` outright and
// never reads it, so two installs cannot stack and either handle's `restore` is the original.
const realFetch = window.fetch

const abortError = (): DOMException => {
  return new DOMException('The operation was aborted.', 'AbortError')
}

// Pending until the signal aborts, as a real in-flight fetch is. @ag-ui/client's HttpAgent does
// pass its AbortController signal, but this CopilotKit's `ProxiedCopilotRuntimeAgent.abortRun`
// never fires it (FINDING-3 in the readme) — so `hang` backs the `Thinking` story/test, not stop.
const untilAborted = (signal: AbortSignal | null | undefined): Promise<never> => {
  return new Promise((_, reject) => {
    if (!signal) return

    if (signal.aborted) {
      reject(abortError())

      return
    }

    signal.addEventListener(
      'abort',
      () => {
        return reject(abortError())
      },
      { once: true },
    )
  })
}

const delay = (ms: number, signal: AbortSignal | null | undefined): Promise<void> => {
  return Promise.race([
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    }),
    untilAborted(signal),
  ])
}

const jsonResponse = (body: string, status: number): Response => {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
}

const sseResponse = (frames: AgUiEvent[]): Response => {
  return new Response(encodeSse(frames), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const readUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input

  return input instanceof URL ? input.href : input.url
}

const readMethod = (input: RequestInfo | URL, init: RequestInit | undefined): string => {
  if (init?.method) return init.method.toUpperCase()

  return input instanceof Request ? input.method.toUpperCase() : 'GET'
}

const readHeaders = (init: RequestInit | undefined): Record<string, string> => {
  const headers: Record<string, string> = {}

  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value
  })

  return headers
}

const resolveRun = (run: RuntimeScenario['run'], runIndex: number, body: RunBody): RunScenario => {
  if (run === undefined) return DEFAULT_RUN
  if (typeof run === 'function') return run(runIndex, body)
  if (Array.isArray(run)) return run[Math.min(runIndex, run.length - 1)] ?? DEFAULT_RUN

  return run
}

const streamedFrames = (threadId: string, messageId: string, words: string[]): AgUiEvent[][] => {
  return [
    [
      { type: 'RUN_STARTED', threadId, runId: 'run-1' },
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    ],
    ...words.map((word): AgUiEvent[] => {
      return [{ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: word }]
    }),
    [
      { type: 'TEXT_MESSAGE_END', messageId },
      { type: 'RUN_FINISHED', threadId, runId: 'run-1' },
    ],
  ]
}

// Batch by batch over a ReadableStream, as API Gateway forwards a `ResponseTransferMode: STREAM` body.
const pacedResponse = (frames: AgUiEvent[][], gapMs: number): Response => {
  const encoder = new TextEncoder()
  let index = 0

  const body = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      if (index > 0) await delay(gapMs, undefined)

      const next = frames[index]

      index += 1

      if (next === undefined) {
        controller.close()

        return
      }

      controller.enqueue(encoder.encode(encodeSse(next)))
    },
  })

  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const answerRun = async (
  scenario: RunScenario,
  runIndex: number,
  body: RunBody,
  signal: AbortSignal | null | undefined,
): Promise<Response> => {
  switch (scenario.kind) {
    case 'reply': {
      await delay(scenario.delayMs ?? 0, signal)

      // Per-run ids: a second turn with the same messageId would collide in react-core's message list.
      return sseResponse(replyFrames(body.threadId ?? 't', scenario.text, `m${runIndex + 1}`))
    }
    case 'frames': {
      await delay(scenario.delayMs ?? 0, signal)

      return sseResponse(scenario.frames)
    }
    case 'streamed':
      return pacedResponse(streamedFrames(body.threadId ?? 't', `m${runIndex + 1}`, scenario.words), scenario.gapMs)
    case 'paced':
      return pacedResponse(scenario.batches, scenario.gapMs)
    case 'http':
      return jsonResponse(
        scenario.body === undefined ? LAMBDA_BODIES[scenario.status] : JSON.stringify(scenario.body),
        scenario.status,
      )
    case 'network-error':
      throw new TypeError('Failed to fetch')
    case 'hang':
      return untilAborted(signal)
  }
}

// What `CustomerChatsRunner.connect` replays; nothing at all for a thread the server does not keep.
const replayFrames = (thread: KeptThread | undefined, connectIndex: number): AgUiEvent[] => {
  if (!thread) return []

  const threadId = thread.id
  const runId = `connect-${connectIndex + 1}`
  const outcome = thread.interrupts?.length ? { outcome: { type: 'interrupt', interrupts: thread.interrupts } } : {}

  return [
    { type: 'RUN_STARTED', threadId, runId },
    { type: 'MESSAGES_SNAPSHOT', messages: thread.messages },
    ...(thread.state ? [{ type: 'STATE_SNAPSHOT', snapshot: thread.state }] : []),
    { type: 'RUN_FINISHED', threadId, runId, ...outcome },
  ]
}

// The Lambda's `GET threads`: the caller's kept chats, newest first, as CopilotKit `ThreadRecord`s.
const threadList = (threads: Map<string, KeptThread>, agentId: string | null): string => {
  const records = [...threads.values()]
    .sort((a, b) => {
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    })
    .map((thread) => {
      const updatedAt = thread.updatedAt ?? new Date(0).toISOString()

      return {
        id: thread.id,
        name: thread.name,
        agentId: agentId ?? 'travelAiAgent',
        organizationId: THREAD_ORGANIZATION_ID,
        createdById: 'traveller',
        archived: false,
        createdAt: updatedAt,
        updatedAt,
        lastRunAt: updatedAt,
      }
    })

  return JSON.stringify({ threads: records, nextCursor: null })
}

// The runner keeps a finished turn under its thread id: the history the browser sent plus the reply.
const keepReply = (threads: Map<string, KeptThread>, body: RunBody, text: string, messageId: string) => {
  const history = body.messages ?? []

  if (!body.threadId || history.length === 0) return

  const firstQuestion = history.find((message) => {
    return message.role === 'user'
  })?.content

  threads.set(body.threadId, {
    id: body.threadId,
    name: typeof firstQuestion === 'string' && firstQuestion ? firstQuestion : 'New conversation',
    messages: [...history, { id: messageId, role: 'assistant', content: text }],
    ...(body.state ? { state: body.state } : {}),
    updatedAt: new Date().toISOString(),
  })
}

const answerInfo = (scenario: RuntimeScenario, infoRequests: number): Response => {
  if (scenario.info === 'unauthorized') return jsonResponse(UNAUTHORIZED_BODY, 401)
  if (scenario.info === 'unauthorized-once' && infoRequests === 1) return jsonResponse(UNAUTHORIZED_BODY, 401)
  if (scenario.info === 'fails-after-handshake' && infoRequests > 1) return jsonResponse(GENERIC_ERROR_BODY, 502)

  // Spread over a copy every time — an override must never mutate the module-level default.
  const overrides = typeof scenario.info === 'object' ? scenario.info.overrides : undefined
  // The Lambda advertises transcription exactly when it can answer it.
  const transcription = scenario.transcribe ? { audioFileTranscriptionEnabled: true } : {}

  return jsonResponse(JSON.stringify({ ...INFO, ...transcription, ...overrides }), 200)
}

const answerTranscribe = async (
  scenario: TranscribeScenario | undefined,
  audio: File | undefined,
): Promise<Response> => {
  // No key: the runtime's 503 `service_not_configured`, which the Lambda rewrites like every 5xx.
  if (!scenario) return jsonResponse(GENERIC_ERROR_BODY, 503)

  if (scenario.kind === 'http') {
    const { body, status } = scenario

    if (body === undefined) return jsonResponse(LAMBDA_BODIES[status], status)

    return jsonResponse(typeof body === 'string' ? body : JSON.stringify(body), status)
  }

  await delay(scenario.delayMs ?? 0, undefined)

  return jsonResponse(JSON.stringify({ text: scenario.text, size: audio?.size ?? 0, type: audio?.type ?? '' }), 200)
}

const readAudio = (init: RequestInit | undefined): File | undefined => {
  const audio = init?.body instanceof FormData ? init.body.get('audio') : null

  return audio instanceof File ? audio : undefined
}

/**
 * Stands in for the Lambda behind AI_CHAT_RUNTIME_URL: answers `/info`, `agent/:id/run`,
 * `agent/:id/suggest`, `agent/:id/stop/:threadId`, `transcribe`, `agent/:id/connect` and `GET threads`
 * (from the scenario's kept `threads`) per `scenario`, denies everything
 * else the way the real handler's allow-list does, and records each run/stop/transcription so a test
 * can assert what went on the wire.
 * Vitest-free so Storybook loaders can use it too. Non-runtime URLs fall through to the real fetch.
 */
export const installRuntimeScenario = (scenario: RuntimeScenario): FakeRuntime => {
  const runs: RunRequest[] = []
  const stops: StopRequest[] = []
  const requests: FakeRequest[] = []
  const denied: FakeRequest[] = []
  const suggests: RunRequest[] = []
  const transcribes: TranscribeRequest[] = []
  const connects: ConnectRequest[] = []

  const threads = new Map(
    (scenario.threads ?? []).map((thread) => {
      return [thread.id, thread]
    }),
  )

  let infoRequests = 0

  // `agent/:id/connect` and `GET threads`, from the kept threads; `undefined` for any other route.
  const answerThreadRoute = (request: FakeRequest, url: string, init: RequestInit | undefined) => {
    if (CONNECT_ROUTE.test(request.path) && request.method === 'POST') {
      const { threadId } = JSON.parse(String(init?.body ?? '{}')) as RunBody
      const connectIndex = connects.length

      connects.push({ url, threadId })

      return sseResponse(replayFrames(threadId === undefined ? undefined : threads.get(threadId), connectIndex))
    }

    if (request.path === THREADS_ROUTE && request.method === 'GET') {
      return jsonResponse(threadList(threads, new URL(url, window.location.origin).searchParams.get('agentId')), 200)
    }

    return undefined
  }

  const fake: typeof window.fetch = async (input, init) => {
    const url = readUrl(input)
    const path = new URL(url, window.location.origin).pathname

    if (!path.startsWith(AI_CHAT_RUNTIME_URL)) return realFetch.call(window, input, init)

    const route = path.slice(AI_CHAT_RUNTIME_URL.length)

    const request: FakeRequest = {
      method: readMethod(input, init),
      path: route,
      headers: readHeaders(init),
      credentials: init?.credentials,
    }

    requests.push(request)

    if (route === '/info') {
      infoRequests += 1

      return answerInfo(scenario, infoRequests)
    }

    if (RUN_ROUTE.test(route)) {
      const body = JSON.parse(String(init?.body ?? '{}')) as RunBody
      const runIndex = runs.length

      runs.push({ url, credentials: init?.credentials, body })

      const run = resolveRun(scenario.run, runIndex, body)
      const response = await answerRun(run, runIndex, body, init?.signal)

      if (run.kind === 'reply') keepReply(threads, body, run.text, `m${runIndex + 1}`)

      return response
    }

    const threadAnswer = answerThreadRoute(request, url, init)

    if (threadAnswer) return threadAnswer

    if (SUGGEST_ROUTE.test(route)) {
      const body = JSON.parse(String(init?.body ?? '{}')) as RunBody

      suggests.push({ url, credentials: init?.credentials, body })

      const frames = toolCallFrames({
        name: 'copilotkitSuggest',
        args: { suggestions: scenario.suggestions ?? DEFAULT_GENERATED_SUGGESTIONS },
      })

      return new Response(encodeSse(frames), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    const stop = STOP_ROUTE.exec(route)

    if (stop?.[1] !== undefined) {
      stops.push({ url, threadId: stop[1] })

      return scenario.stop === 'http-500' ? jsonResponse(GENERIC_ERROR_BODY, 500) : jsonResponse('{}', 200)
    }

    if (route === TRANSCRIBE_ROUTE && request.method === 'POST') {
      const audio = readAudio(init)

      transcribes.push({ url, audio })

      return answerTranscribe(scenario.transcribe, audio)
    }

    // Everything off the allow-list — `threads/:id/*`, `threads/clear`, the thread mutations — the
    // Lambda's own `isAllowedRoute` (vendor/packages/ai-chat-be/src/lambda/copilotkit.ts) 404s the same way.
    denied.push(request)

    return jsonResponse(NOT_FOUND_BODY, 404)
  }

  window.fetch = fake

  return {
    runs,
    suggests,
    stops,
    transcribes,
    connects,
    threads,
    requests,
    denied,
    restore: () => {
      window.fetch = realFetch
    },
  }
}

export const installFakeRuntime = (reply: string): FakeRuntime => {
  return installRuntimeScenario({ run: { kind: 'reply', text: reply } })
}
