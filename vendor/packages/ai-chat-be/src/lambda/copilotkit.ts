import { EventType } from '@ag-ui/client'
import type { APIGatewayProxyResult, Context } from 'aws-lambda'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import path from 'node:path'
import process from 'node:process'
import type { Writable } from 'node:stream'
import { finished } from 'node:stream/promises'

import type { A2uiRuntimeOptions } from '../copilotkit/a2ui.js'
import type { HistorySummarizer } from '../copilotkit/historySummary.js'
import type { InProcessAgentConfig } from '../copilotkit/inProcessAgent.js'
import { runWithRequestContext } from '../copilotkit/requestContext.js'
import type { ChatRequestContext, TurnRefusal } from '../copilotkit/requestContext.js'
import { modelIdentityLabel } from '../langgraph/modelIdentity.js'
import { tracedCoreCopies } from '../langgraph/traceMasking.js'
import type { LangChainCoreCopy } from '../langgraph/traceMasking.js'
import { consoleJsonLogger } from '../ports.js'
import type { ChatLogger, ChatLoggerFactory, ChatStorage } from '../ports.js'
import { settleBackgroundWrites } from '../tools/backgroundWrites.js'
import { buildCorsHeaders } from './cors.js'
import { verifyCustomerSession } from './customerSession.js'
import type { CustomerSessionIdentity } from './customerSession.js'
import { admitDailyRun, admitDailySpend } from './usage.js'
import type { SpendAdmission } from './usage.js'

// REST API GW (v1) event; the v2 (HTTP API / Function URL) shape is tolerated so a
// future ingress change needs no rewrite — see apps/ai/ARCHITECTURE.md "Streaming".
export interface ProxyEventLike {
  body?: string | null
  isBase64Encoded?: boolean
  headers?: Record<string, string | undefined>
  rawPath?: string
  rawQueryString?: string
  path?: string
  httpMethod?: string
  queryStringParameters?: Record<string, string | undefined> | null
  requestContext?: { http?: { method?: string } }
}

type FetchHandler = (req: Request) => Promise<Response>

const filename = path.basename(import.meta.url)

// Headroom under the Lambda's remaining time so a slow turn returns a well-formed
// SSE body (partial answer + RUN_ERROR) instead of an API Gateway 504.
const DRAIN_MARGIN_MS = 3000
const MIN_DRAIN_MS = 1000
// Local/unit invocations have no Lambda context.
const DEFAULT_DRAIN_MS = 22000
const SSE_FRAME_SEPARATOR = '\n\n'
const TIMEOUT = Symbol('timeout')
const NOT_FOUND_BODY = JSON.stringify({ error: 'Not found', type: 'NOT_FOUND' })
const UNAUTHORIZED_BODY = JSON.stringify({ error: 'Sign in to use the assistant.', type: 'UNAUTHENTICATED' })
const GENERIC_ERROR_MESSAGE = 'The assistant is unavailable right now.'
const GENERIC_ERROR_BODY = JSON.stringify({ error: GENERIC_ERROR_MESSAGE, type: 'INTERNAL_ERROR' })
const HTTP_SERVER_ERROR_MIN = 500
// react-core sends a UUID; anything else is hand-built.
const THREAD_ID_PATTERN = /^[\w-]{1,128}$/
// The FE resends the full history each run and `capHistory` keeps ≤300k chars of it, so a
// legitimate body stays far below this; API GW would accept 10 MB of model input otherwise.
const MAX_BODY_BYTES = 512 * 1024
const PAYLOAD_TOO_LARGE_BODY = JSON.stringify({ error: 'The conversation is too long.', type: 'PAYLOAD_TOO_LARGE' })
const TOO_MANY_REQUESTS_BODY = JSON.stringify({ error: 'Slow down a little.', type: 'TOO_MANY_REQUESTS' })

// `type` is what the client maps to its own copy: unlike the burst throttle, waiting a minute will not help.
const DAILY_QUOTA_BODY = JSON.stringify({
  error: "You've reached today's assistant limit. It resets at midnight UTC.",
  type: 'DAILY_QUOTA_EXCEEDED',
})

// The quota could not be read: refused rather than run unmetered (`usage.ts`); a retry soon may pass.
const QUOTA_UNAVAILABLE_BODY = JSON.stringify({
  error: 'The assistant is unavailable right now. Try again in a moment.',
  type: 'QUOTA_UNAVAILABLE',
})

// Every traveller's spend today is over the global cap (`usage.ts`): nothing a traveller does helps
// until the UTC day turns, so the client shows its own copy for this `type`.
const SERVICE_BUDGET_EXHAUSTED_BODY = JSON.stringify({
  error: 'The assistant is resting for today. Try again tomorrow.',
  type: 'SERVICE_BUDGET_EXHAUSTED',
})

// A 204 would carry no body, and the Lambda stream sends its status prelude only with the first body
// write: an empty streamed response reaches API Gateway with no status line, which answers it with a
// 502 "Internal server error".
// A suggestion body that would run as a full chat turn (`suggestHistory.ts`).
const INVALID_SUGGESTION_BODY = JSON.stringify({ error: 'Invalid suggestion request.', type: 'BAD_REQUEST' })

const FEEDBACK_STORED_BODY = JSON.stringify({ stored: true })
const INVALID_FEEDBACK_BODY = JSON.stringify({ error: 'Invalid feedback.', type: 'BAD_REQUEST' })
// `{ threadId, messageId, rating, reason ≤ 500 }` is far below this.
const MAX_FEEDBACK_BODY_BYTES = 4 * 1024

// Per-traveller burst throttle, per warm container: the cheap first layer in front of the
// DB-backed daily quota (`usage.ts`), bounding a tight client loop without a database round trip.
// A suggestion follows every answer, so it has a budget of its own: sharing one would halve the
// turns a traveller gets.
const RUN_LIMIT_PER_WINDOW = 30
const RUN_WINDOW_MS = 10 * 60 * 1000
// A connect bills no model but reads a whole kept chat (up to 1 MB) from Postgres; reopening chats
// from the sidebar is cheap for a person and unbounded for a loop. A feedback vote is one small write.
const CONNECT_LIMIT_PER_WINDOW = 120
const runWindows = new Map<string, { startedAt: number; runs: number }>()
let lastSweepAt = 0

type ModelRoute = 'run' | 'suggest' | 'transcribe'
type ThrottledRoute = ModelRoute | 'connect' | 'feedback'

// A warm container lives for hours and sees every traveller who chats in that time; without the
// sweep the map would hold one entry per traveller per route forever.
const sweepExpiredWindows = (now: number): void => {
  if (now - lastSweepAt < RUN_WINDOW_MS) return

  lastSweepAt = now

  for (const [key, window] of runWindows) {
    if (now - window.startedAt >= RUN_WINDOW_MS) runWindows.delete(key)
  }
}

const admitRun = (customerId: string, route: ThrottledRoute, now = Date.now()): boolean => {
  sweepExpiredWindows(now)

  const key = `${route}:${customerId}`
  const window = runWindows.get(key)

  if (!window || now - window.startedAt >= RUN_WINDOW_MS) {
    runWindows.set(key, { startedAt: now, runs: 1 })

    return true
  }

  window.runs += 1

  return window.runs <= (route === 'connect' || route === 'feedback' ? CONNECT_LIMIT_PER_WINDOW : RUN_LIMIT_PER_WINDOW)
}

/** The per-container throttle's tracked windows; exposed so a test can prove the sweep bounds it. */
export const __trackedThrottleWindows = (): number => {
  return runWindows.size
}

// The routes that bill a model call: `agent/:id/run`, the stateless `agent/:id/suggest`, and
// `transcribe` (speech-to-text on the runtime root, not under an agent).
const modelRouteOf = (path: string): ModelRoute | undefined => {
  const segments = path.split('/').filter(Boolean)
  const last = segments.at(-1)

  if (last === 'transcribe' && segments.at(-2) === 'copilotkit') return 'transcribe'

  if (segments.at(-3) !== 'agent') return undefined

  return last === 'run' || last === 'suggest' ? last : undefined
}

// `agent/:id/connect`: replays the caller's kept chat (`CustomerChatsRunner.connect`). No model call.
const isConnectRoute = (path: string): boolean => {
  const segments = path.split('/').filter(Boolean)

  return segments.at(-3) === 'agent' && segments.at(-1) === 'connect'
}

// `GET threads` on the runtime root (react-core `useThreads`) — the list only; `threads/:id/*` and
// `threads/clear` stay unreachable.
const isThreadListRoute = (path: string): boolean => {
  const segments = path.split('/').filter(Boolean)

  return segments.at(-1) === 'threads' && segments.at(-2) === 'copilotkit'
}

// `POST feedback` on the runtime root: answered by this Lambda (`feedback.ts`), never by the runtime.
const isFeedbackRoute = (path: string): boolean => {
  const segments = path.split('/').filter(Boolean)

  return segments.at(-1) === 'feedback' && segments.at(-2) === 'copilotkit'
}

const DEFAULT_THREAD_LIST_LIMIT = 20

/** The agent a host serves: the `InProcessAgent` config plus the A2UI catalog its surfaces draw from. */
export interface ChatAgentDefinition extends InProcessAgentConfig {
  /**
   * Absent: `/info` reports A2UI off. A browser that holds a catalog still sends
   * `a2uiCatalogAvailable`, on which the runtime attaches the middleware with its defaults.
   */
  a2ui?: A2uiRuntimeOptions
  /**
   * The @langchain/core copy the graph runs on, imported by the agent's own package. Its LangSmith
   * client is masked and its trace queue flushed like this package's; without it a second core install
   * traces with neither (`langgraph/traceMasking.ts`).
   */
  langChainCore?: LangChainCoreCopy
  /** Summarises the turns a long chat drops from the model input; absent, they are dropped unsummarised. */
  summarizeHistory?: HistorySummarizer
}

/** The product the engine serves, in the words a traveller and the model read. */
export interface ChatAppIdentity {
  /**
   * The speaker of a server-written turn (a background run's summary marker, `<name>: background search …`)
   * and the name in the outage notice (`<name>'s assistant is temporarily unavailable…`).
   */
  name: string
  /** The `organizationId` of every thread record the list route answers with. */
  organizationId: string
}

export interface CopilotkitHandlerOptions {
  /** Kept chats, the daily quota, run leases and failed runs: read and written only through these. */
  storage: ChatStorage
  app: ChatAppIdentity
  /** The issuer and audience of the customer session token the host's sign-in mints. */
  session: CustomerSessionIdentity
  /**
   * Called on the first request that reaches the runtime, never at module load: an agent module
   * constructs its model on import, and a missing key or packaging gap must surface as a catchable
   * error instead of a cold-start 502 — see apps/ai/ARCHITECTURE.md "Why InProcessAgent exists".
   */
  loadAgent: () => Promise<ChatAgentDefinition>
  /**
   * Response headers beyond the request id and model label, exposed to page script like them
   * (e.g. the corpus snapshot an agent's tools read). Read on every response, gate refusals included.
   */
  identityHeaders?: Readonly<Record<string, () => string>>
  /**
   * Every engine log line goes through it, each module under its own service name. Absent:
   * `consoleJsonLogger`, which is for tests and local runs; a deployed host passes its own.
   */
  createLogger?: ChatLoggerFactory
}

// What a request path logs through: the handler pair's own logger (it carries the request's keys)
// and the factory the lazily loaded modules build theirs from.
interface HandlerLogs {
  logger: ChatLogger
  createLogger: ChatLoggerFactory
}

// What the gate in front of the runtime reads beside the logs.
interface GateDeps extends HandlerLogs {
  storage: ChatStorage
  session: CustomerSessionIdentity
}

// What the runtime is built from, once, on the first request that passes the gate.
interface RuntimeDeps {
  loadAgent: CopilotkitHandlerOptions['loadAgent']
  storage: ChatStorage
  app: ChatAppIdentity
  createLogger: ChatLoggerFactory
}

// Lazy imports so a bundling gap surfaces as a catchable error rather than a 502 at
// module load. The agent is also registered as `default` — CopilotPopup resolves that id.
const createFetchHandler = async ({ loadAgent, storage, app, createLogger }: RuntimeDeps): Promise<FetchHandler> => {
  const { CopilotSseRuntime, createCopilotRuntimeHandler } = await import('@copilotkit/runtime/v2')
  const { InProcessAgent } = await import('../copilotkit/inProcessAgent.js')
  const { maskTraceContent } = await import('../langgraph/traceMasking.js')
  const { a2ui, langChainCore, summarizeHistory, ...agentConfig } = await loadAgent()

  // Before the first run, so no trace ever leaves with the traveller's text in it. Loading the agent
  // builds its model and graph, which make no LangSmith client yet.
  await maskTraceContent(langChainCore === undefined ? [] : [langChainCore])

  const agent = new InProcessAgent({
    ...agentConfig,
    appName: app.name,
    createLogger,
    recordFailure: async (failure) => {
      await storage.runFailures.record(failure)
    },
  })

  const { GeminiTranscriptionService, isTranscriptionConfigured } =
    await import('../transcription/geminiTranscription.js')

  const { CustomerChatsRunner } = await import('../copilotkit/customerChatsRunner.js')

  const runner = new CustomerChatsRunner({
    storage,
    app,
    agentIds: [agentConfig.graphId, 'default'],
    createLogger,
    ...(summarizeHistory === undefined ? {} : { summarizeHistory }),
    ...(a2ui ? { a2ui } : {}),
  })

  // Without a key the runtime reports `audioFileTranscriptionEnabled: false` and the browser
  // never shows the microphone, rather than offering one that always fails. `openGenerativeUI` is
  // deliberately absent: `/info` would switch model-written HTML on for every client (owner decision).
  const runtime = new CopilotSseRuntime({
    agents: { [agentConfig.graphId]: agent, default: agent },
    runner,
    // The runtime (1.88) lists threads only for a caller it can name, and reports that in `/info`; ours
    // names nobody, because the list is answered below from the caller's own chats, never by the runtime.
    threads: { access: 'open' },
    ...(a2ui ? { a2ui } : {}),
    ...(isTranscriptionConfigured() ? { transcriptionService: new GeminiTranscriptionService({ createLogger }) } : {}),
  })

  const runtimeHandler = createCopilotRuntimeHandler({ runtime, cors: true })

  // The runtime's own `GET threads` reads the runner synchronously and knows no caller; the list
  // is answered here, from the caller's chats. `/info` still reports `threadEndpoints.list: true`
  // because the runner declares local thread endpoints and thread access is `open`.
  return async (request) => {
    if (request.method !== 'GET' || !isThreadListRoute(new URL(request.url).pathname)) return runtimeHandler(request)

    const query = new URL(request.url).searchParams
    const limit = Number.parseInt(query.get('limit') ?? '', 10)

    return Response.json(
      await runner.listCustomerThreads(query.get('agentId'), Number.isNaN(limit) ? DEFAULT_THREAD_LIST_LIMIT : limit),
    )
  }
}

// A failed build is answered from memory for a while (a missing key fails every request the same way,
// and the build is expensive), then retried: a transient failure (a slow secret fetch, a DB blip in
// the agent's import) must not leave a warm container broken for its whole life.
export const INIT_ERROR_TTL_MS = 30_000

// One runtime per handler pair, built on first use.
const memoizeFetchHandler = (deps: RuntimeDeps): (() => Promise<FetchHandler>) => {
  let fetchHandlerCache: FetchHandler | undefined
  let initFailure: { error: unknown; at: number } | undefined

  return async () => {
    if (fetchHandlerCache) return fetchHandlerCache
    if (initFailure && Date.now() - initFailure.at < INIT_ERROR_TTL_MS) throw initFailure.error

    try {
      fetchHandlerCache = await createFetchHandler(deps)
      initFailure = undefined

      return fetchHandlerCache
    } catch (err) {
      initFailure = { error: err, at: Date.now() }
      throw err
    }
  }
}

const getPath = (event: ProxyEventLike): string => {
  return event.rawPath ?? event.path ?? '/'
}

const getMethod = (event: ProxyEventLike): string => {
  return (event.requestContext?.http?.method ?? event.httpMethod ?? 'GET').toUpperCase()
}

const buildHeaders = (event: ProxyEventLike): Headers => {
  const headers = new Headers()

  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value)
  }

  return headers
}

const buildQueryString = (event: ProxyEventLike): string => {
  if (event.rawQueryString) return `?${event.rawQueryString}`

  const entries = Object.entries(event.queryStringParameters ?? {}).filter((entry): entry is [string, string] => {
    return entry[1] !== undefined
  })

  if (entries.length === 0) return ''

  return `?${new URLSearchParams(entries).toString()}`
}

const buildBody = (event: ProxyEventLike, method: string): BodyInit | null => {
  const methodAllowsBody = method !== 'GET' && method !== 'HEAD'

  if (!methodAllowsBody || event.body === null || event.body === undefined) return null

  return event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body
}

// The runtime is multi-route; its per-thread routes (`threads/:id/messages|events|state`,
// `POST threads/clear`, the thread mutations) have no notion of a caller. Only the routes the
// frontend actually uses are reachable, and the two that read history (`agent/:id/connect`,
// `GET threads`) are answered from the caller's own chats by `CustomerChatsRunner`. OPTIONS
// passes for CORS.
export const isAllowedRoute = (path: string, method: string): boolean => {
  if (method === 'OPTIONS') return true

  const segments = path.split('/').filter(Boolean)
  const last = segments.at(-1)

  if (method === 'GET') return last === 'info' || isThreadListRoute(path)
  if (method !== 'POST') return false

  // react-core posts `agent/:id/run`, `agent/:id/connect`, `agent/:id/stop/:threadId`, the
  // suggestion engine `agent/:id/suggest` — a stateless run that never touches the runner — and
  // the composer's microphone `transcribe`. `feedback` is answered before the runtime.
  if (modelRouteOf(path) || isConnectRoute(path) || isFeedbackRoute(path)) return true

  return segments.at(-4) === 'agent' && segments.at(-2) === 'stop'
}

// The CopilotKit v2 runtime matches its routes (`/info`, `/agent/:id/run`) by suffix.
export const buildRequest = (event: ProxyEventLike, signal?: AbortSignal): Request => {
  const headers = buildHeaders(event)
  const proto = headers.get('x-forwarded-proto') ?? 'https'
  const host = headers.get('host') ?? 'lambda.local'
  const url = `${proto}://${host}${getPath(event)}${buildQueryString(event)}`
  const method = getMethod(event)

  return new Request(url, { method, headers, body: buildBody(event, method), signal: signal ?? null })
}

export const buildRunErrorFrame = (message: string): string => {
  return `data: ${JSON.stringify({ type: EventType.RUN_ERROR, message })}${SSE_FRAME_SEPARATOR}`
}

// The AG-UI parser flushes its tail buffer on completion, so a half-written frame would hit JSON.parse.
export const truncateToLastCompleteFrame = (sse: string): string => {
  const lastBoundary = sse.lastIndexOf(SSE_FRAME_SEPARATOR)

  return lastBoundary === -1 ? '' : sse.slice(0, lastBoundary + SSE_FRAME_SEPARATOR.length)
}

// In-process the runtime's TransformStream yields strings, over the network Uint8Array;
// `TextDecoder.decode` on a string throws (a 570 with no reply), so handle both.
export const decodeChunk = (value: unknown, decoder: TextDecoder): string => {
  if (typeof value === 'string') return value

  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return decoder.decode(value as ArrayBufferView, { stream: true })
  }

  return String(value)
}

const createDeadline = <TToken = typeof TIMEOUT>(ms: number, token: TToken = TIMEOUT as TToken) => {
  let timer: NodeJS.Timeout | undefined

  const promise = new Promise<TToken>((resolve) => {
    timer = setTimeout(resolve, ms, token)
  })

  return {
    promise,
    clear: () => {
      return clearTimeout(timer)
    },
  }
}

interface DrainResult {
  text: string
  timedOut: boolean
}

// API GW buffers the whole response anyway (the client's SSE parser is a plain accumulator).
// Draining against our own deadline degrades a slow turn into partial answer + RUN_ERROR.
const drainWithDeadline = async (body: ReadableStream<unknown>, deadlineMs: number): Promise<DrainResult> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const deadline = createDeadline(deadlineMs)
  let text = ''

  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline.promise])

      if (next === TIMEOUT) return { text, timedOut: true }
      if (next.done) return { text: text + decoder.decode(), timedOut: false }
      if (next.value) text += decodeChunk(next.value, decoder)
    }
  } finally {
    deadline.clear()

    // A rejected cancel must not mask the result.
    void reader.cancel().catch(() => {
      return undefined
    })
  }
}

const resolveDeadlineMs = (context: Context | undefined): number => {
  const remaining = context?.getRemainingTimeInMillis?.()

  if (typeof remaining !== 'number') return DEFAULT_DRAIN_MS

  return Math.max(MIN_DRAIN_MS, remaining - DRAIN_MARGIN_MS)
}

// Only a run request carries a thread; parsed lazily because it is needed on timeout alone.
const readThreadId = (event: ProxyEventLike): string | undefined => {
  const body = buildBody(event, 'POST')

  if (body === null) return undefined

  try {
    const parsed: unknown = JSON.parse(String(body))

    if (typeof parsed !== 'object' || parsed === null || !('threadId' in parsed)) return undefined

    const { threadId } = parsed as { threadId: unknown }

    // Spliced into a runtime URL below: an id with `/` or `..` would route the stop call at
    // the hidden thread/memory routes the allow-list exists to keep unreachable.
    return typeof threadId === 'string' && THREAD_ID_PATTERN.test(threadId) ? threadId : undefined
  } catch {
    return undefined
  }
}

// Aborting the request only closes the SSE stream; the runner keeps the thread locked and
// the agent keeps the provider call open until the model finishes. The stop route is the
// runtime's own cancel path: it releases the lock and calls `agent.abortRun()`.
const stopRun = async (
  fetchHandler: FetchHandler,
  event: ProxyEventLike,
  runRequest: Request,
  logger: ChatLogger,
): Promise<void> => {
  const threadId = readThreadId(event)
  const runUrl = new URL(runRequest.url)
  const segments = runUrl.pathname.split('/').filter(Boolean)
  const agentId = segments.at(-2)

  if (!threadId || !agentId || segments.at(-1) !== 'run') return

  runUrl.pathname = `/${[...segments.slice(0, -1), 'stop', threadId].join('/')}`
  runUrl.search = ''

  const response = await fetchHandler(new Request(runUrl, { method: 'POST' }))

  logger.warn('CopilotKit run stopped after the response deadline', { threadId, agentId, statusCode: response.status })
}

const readResponseBody = async (
  response: Response,
  context: Context,
  onTimeout: () => Promise<void>,
  logger: ChatLogger,
): Promise<string> => {
  if (!response.body) return ''

  const { text, timedOut } = await drainWithDeadline(response.body, resolveDeadlineMs(context))

  if (!timedOut) return text

  logger.error('CopilotKit run exceeded the response deadline', { bytes: text.length })
  await onTimeout()

  return truncateToLastCompleteFrame(text) + buildRunErrorFrame('The assistant took too long to respond.')
}

const jsonResponse = (statusCode: number, body: string, baseHeaders: Record<string, string>): APIGatewayProxyResult => {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...baseHeaders }, body }
}

// Non-secret identity carried by every response: which model answered, which research-corpus
// version its loyalty tools read (the host's `identityHeaders`), and the CloudWatch correlation key
// already used as the handler's log key. An e2e run reports all three without reading the logs. The
// model label is resolved from the environment (`modelIdentity.ts`), never from the graph module,
// whose import is lazy on purpose.
const buildIdentityHeaders = (
  context: Context | undefined,
  extra: CopilotkitHandlerOptions['identityHeaders'] = {},
): Record<string, string> => {
  return {
    'x-ai-request-id': context?.awsRequestId || 'noRequestId',
    'x-ai-model': modelIdentityLabel(),
    ...Object.fromEntries(
      Object.entries(extra).map(([name, read]) => {
        return [name, read()]
      }),
    ),
  }
}

// A cross-origin fetch only lets page script read headers named here.
const identityHeaderNames = (extra: CopilotkitHandlerOptions['identityHeaders'] = {}): string => {
  return ['x-ai-request-id', 'x-ai-model', ...Object.keys(extra)].join(', ')
}

// Everything answered before the runtime (and its cold-start import) is touched: the route
// allow-list, the traveller session, the body ceiling on a run or a connect, the per-traveller
// throttle, the daily run quota, and the feedback route, which never reaches the runtime at all.
// OPTIONS stays open: a pre-flight never carries cookies.
// `customerId` is returned, not only appended to the log keys, because the graph needs it:
// `config.configurable.customerId` is what attributes a server-tool invocation.
// `event` replaces the caller's when the gate rewrote its body (the suggestion route's history).
interface RuntimeGate {
  response?: APIGatewayProxyResult
  customerId?: string
  event?: ProxyEventLike
  /** A run let in as a follow-up, uncounted: the runner counts it if it turns out to carry a question. */
  countTurn?: ChatRequestContext['countTurn']
}

// The runtime routes on `new URL(...).pathname`, which cuts at a literal `?` or `#` and resolves
// dot segments; the allow-list reads the raw path. Any path the two would read differently (or
// that smuggles encoded separators) is refused, so the gate and the router always agree.
const SMUGGLED_SEPARATOR = /[?#\\]|%(?:2e|2f|3f|23|5c)/iu

export const isRoutablePath = (path: string): boolean => {
  if (SMUGGLED_SEPARATOR.test(path)) return false

  try {
    return new URL(path, 'https://lambda.local').pathname === path
  } catch {
    return false
  }
}

const answerFeedback = async (
  event: ProxyEventLike,
  customerId: string,
  baseHeaders: Record<string, string>,
  { storage, createLogger }: GateDeps,
): Promise<APIGatewayProxyResult> => {
  if ((event.body?.length ?? 0) > MAX_FEEDBACK_BODY_BYTES) {
    return jsonResponse(413, PAYLOAD_TOO_LARGE_BODY, baseHeaders)
  }

  if (!admitRun(customerId, 'feedback')) return jsonResponse(429, TOO_MANY_REQUESTS_BODY, baseHeaders)

  // Lazy like the runtime: a packaging gap in zod fails this route, not every cold start.
  const { storeFeedback } = await import('./feedback.js')
  const body = buildBody(event, 'POST')

  const outcome = await storeFeedback(customerId, body === null ? null : String(body), {
    history: storage.history,
    dropConnections: () => {
      storage.dropConnections()
    },
    createLogger,
  })

  if (outcome === 'invalid') return jsonResponse(400, INVALID_FEEDBACK_BODY, baseHeaders)

  return jsonResponse(200, FEEDBACK_STORED_BODY, baseHeaders)
}

// A run that answers the assistant rather than asking it: the browser's last message is a tool
// result (a frontend form or tool), or the body resumes a paused question. Read from the raw body,
// before the runtime; anything unreadable counts as a turn. Such a run is let in uncounted, and the
// runner counts it after all when its trusted history (`trustedHistory`) carries a new question, so a
// forged follow-up buys only a rerun of the kept history, which the burst throttle bounds. A surface
// button press also ends on a tool result, but the A2UI middleware turns its `forwardedProps.a2uiAction`
// into a user message the model answers, so it is a turn of its own.
export const isFollowUpRun = (event: ProxyEventLike): boolean => {
  const body = buildBody(event, 'POST')

  try {
    const { messages, resume, forwardedProps } = JSON.parse(String(body)) as {
      messages?: unknown
      resume?: unknown
      forwardedProps?: { a2uiAction?: unknown } | null
    }

    if (forwardedProps?.a2uiAction !== undefined) return false

    const last: unknown = Array.isArray(messages) ? messages.at(-1) : undefined

    return (
      (Array.isArray(resume) && resume.length > 0) ||
      (typeof last === 'object' && last !== null && (last as { role?: unknown }).role === 'tool')
    )
  } catch {
    return false
  }
}

// What a request retried after a dropped connection repeats, so it is counted once (`usage.ts`): the
// run's id, and a digest of the thread, its user turns and the forwarded props that make the runner
// answer again (`regenerateFrom`, `programSummaryOf`). The id alone is the browser's to choose; a
// script reusing it with a new question, a regenerate or a summary turn changes the digest and spends a turn.
export const runCountKey = (event: ProxyEventLike): string | undefined => {
  try {
    const { runId, threadId, messages, forwardedProps } = JSON.parse(String(buildBody(event, 'POST'))) as {
      runId?: unknown
      threadId?: unknown
      messages?: unknown
      forwardedProps?: { regenerateFrom?: unknown; programSummaryOf?: unknown } | null
    }

    if (typeof runId !== 'string' || !THREAD_ID_PATTERN.test(runId)) return undefined

    const userTurns = (Array.isArray(messages) ? messages : [])
      .filter((message: unknown) => {
        return (message as { role?: unknown } | null)?.role === 'user'
      })
      .map((message: unknown) => {
        const { id, content } = message as { id?: unknown; content?: unknown }

        return [id, content]
      })

    const digest = createHash('sha256')
      .update(JSON.stringify([threadId, userTurns, forwardedProps?.regenerateFrom, forwardedProps?.programSummaryOf]))
      .digest('hex')
      .slice(0, RUN_DIGEST_HEX_CHARS)

    return `${runId}.${digest}`
  } catch {
    return undefined
  }
}

// 64 bits: a digest only has to tell one traveller's questions apart within the retry window.
const RUN_DIGEST_HEX_CHARS = 16

const turnRefusalOf = (admission: SpendAdmission): TurnRefusal | undefined => {
  const typed = (body: string): TurnRefusal => {
    const { error, type } = JSON.parse(body) as { error: string; type: string }

    return { code: type, message: error }
  }

  switch (admission) {
    case 'admitted':
      return undefined
    case 'over_quota':
      return typed(DAILY_QUOTA_BODY)
    case 'service_exhausted':
      return typed(SERVICE_BUDGET_EXHAUSTED_BODY)
    case 'unknown_customer':
      return typed(UNAUTHORIZED_BODY)
    default:
      return typed(QUOTA_UNAVAILABLE_BODY)
  }
}

const refusalOf = (
  admission: SpendAdmission,
  route: ModelRoute,
  baseHeaders: Record<string, string>,
  logger: ChatLogger,
): APIGatewayProxyResult | undefined => {
  switch (admission) {
    case 'admitted':
      return undefined
    case 'over_quota':
      return jsonResponse(429, DAILY_QUOTA_BODY, baseHeaders)
    case 'service_exhausted':
      return jsonResponse(503, SERVICE_BUDGET_EXHAUSTED_BODY, baseHeaders)
    case 'unknown_customer':
      logger.warn('CopilotKit request rejected: the session names a traveller who no longer exists', { route })

      return jsonResponse(401, UNAUTHORIZED_BODY, baseHeaders)
    case 'unavailable':
      // `metric` is a top-level key: the CloudWatch metric filter matches `$.metric`.
      logger.error('CopilotKit request refused: the daily quota could not be read', {
        metric: 'quota_unavailable',
        route,
      })

      return jsonResponse(503, QUOTA_UNAVAILABLE_BODY, baseHeaders)
    default:
      return undefined
  }
}

interface QuotaGate {
  response: APIGatewayProxyResult | undefined
  countTurn?: ChatRequestContext['countTurn']
}

// Only a new turn counts against the day's runs: a form answer or a resumed question continues the
// turn the traveller already spent, and a suggestion or a transcription rides beside one — but each
// bills tokens, so each must fit the day's token budget and the global one. A follow-up gets the
// counter to call should the runner find a question in it after all.
const refuseOverDailyQuota = async (
  event: ProxyEventLike,
  customerId: string,
  route: ModelRoute,
  baseHeaders: Record<string, string>,
  { logger, createLogger, storage }: GateDeps,
): Promise<QuotaGate> => {
  const countKey = route === 'run' ? runCountKey(event) : undefined
  const { usage } = storage

  const dropConnections = () => {
    storage.dropConnections()
  }

  if (route === 'run' && !isFollowUpRun(event)) {
    return {
      response: refusalOf(
        await admitDailyRun(customerId, countKey, { usage, dropConnections, createLogger }),
        route,
        baseHeaders,
        logger,
      ),
    }
  }

  const response = refusalOf(
    await admitDailySpend(customerId, { usage, dropConnections, createLogger }),
    route,
    baseHeaders,
    logger,
  )

  if (response || route !== 'run') return { response }

  return {
    response: undefined,
    countTurn: async () => {
      // The runtime is running: its own queries share the pool, so a stalled count must not drop it.
      return turnRefusalOf(await admitDailyRun(customerId, countKey, { usage, createLogger }))
    },
  }
}

// The suggestion route never reaches the runner: the gate itself swaps in the kept transcript and pins the
// run to the suggestion tool (`suggestHistory.ts`).
const gateSuggestion = async (
  event: ProxyEventLike,
  customerId: string,
  baseHeaders: Record<string, string>,
  { storage, createLogger }: GateDeps,
): Promise<RuntimeGate> => {
  const { trustedSuggestBody } = await import('./suggestHistory.js')
  const raw = buildBody(event, 'POST')

  const body = await trustedSuggestBody(raw === null ? null : String(raw), customerId, {
    read: async (owner, threadId) => {
      return storage.history.getChat(owner, threadId)
    },
    dropConnections: () => {
      storage.dropConnections()
    },
    createLogger,
  })

  if (body === undefined) return { response: jsonResponse(400, INVALID_SUGGESTION_BODY, baseHeaders) }

  return { customerId, event: { ...event, body, isBase64Encoded: false } }
}

const gateBeforeRuntime = async (
  event: ProxyEventLike,
  path: string,
  method: string,
  baseHeaders: Record<string, string>,
  logs: GateDeps,
): Promise<RuntimeGate> => {
  const { logger } = logs

  if (!isRoutablePath(path) || !isAllowedRoute(path, method)) {
    return { response: jsonResponse(404, NOT_FOUND_BODY, baseHeaders) }
  }
  if (method === 'OPTIONS') return {}

  // Every runtime route bills a model key or reads the traveller's chats, so all of them sit behind
  // the session (customerSession.ts).
  const session = verifyCustomerSession(event.headers, logs.session)

  if (!session) {
    logger.warn('CopilotKit request rejected: no valid customer session', { path, method })

    return { response: jsonResponse(401, UNAUTHORIZED_BODY, baseHeaders) }
  }

  logger.appendKeys({ customerId: session.customerId })

  const admitted = { customerId: session.customerId }

  if (isFeedbackRoute(path)) return { response: await answerFeedback(event, session.customerId, baseHeaders, logs) }

  const modelRoute = modelRouteOf(path)

  if (!modelRoute && !isConnectRoute(path)) return admitted

  if ((event.body?.length ?? 0) > MAX_BODY_BYTES) {
    logger.warn('CopilotKit run rejected: body over the ceiling', { bytes: event.body?.length })

    return { response: jsonResponse(413, PAYLOAD_TOO_LARGE_BODY, baseHeaders) }
  }

  // A connect bills no model, so it has a budget of its own and never spends a turn.
  const route: ThrottledRoute = modelRoute ?? 'connect'

  if (!admitRun(session.customerId, route)) {
    logger.warn('CopilotKit run rejected: per-traveller throttle', { route })

    return { response: jsonResponse(429, TOO_MANY_REQUESTS_BODY, baseHeaders) }
  }

  const quota: QuotaGate = modelRoute
    ? await refuseOverDailyQuota(event, session.customerId, modelRoute, baseHeaders, logs)
    : { response: undefined }

  if (quota.response) return { response: quota.response }

  if (modelRoute === 'suggest') return gateSuggestion(event, session.customerId, baseHeaders, logs)

  return quota.countTurn === undefined ? admitted : { ...admitted, countTurn: quota.countTurn }
}

// Buffered, not streamed: API GW's 29s edge integration timeout is the hard ceiling.
// See apps/ai/ARCHITECTURE.md "Streaming" for the trade-off.
// One map threaded through every response path, so none can lose the identity headers: the
// gate's 404/401/413/429, the runtime 5xx, the success body and the catch block.
const buildBaseHeaders = (
  event: ProxyEventLike,
  context: Context | undefined,
  extra: CopilotkitHandlerOptions['identityHeaders'],
): Record<string, string> => {
  return {
    ...buildIdentityHeaders(context, extra),
    ...buildCorsHeaders(event.headers, {
      allowMethods: 'GET, POST, OPTIONS',
      allowHeaders: 'Content-Type, Authorization',
      exposeHeaders: identityHeaderNames(extra),
    }),
  }
}

// What one handler pair closes over: its own runtime and its host's extra identity headers.
interface HandlerBackend extends GateDeps {
  getFetchHandler: () => Promise<FetchHandler>
  identityHeaders: CopilotkitHandlerOptions['identityHeaders']
}

// Every error that reaches the catch is a plain one (nothing in the chat path throws a typed HTTP
// error), so it answers 500 with the error's message; dev and local stages also log its stack.
const describeError = (error: unknown): { httpErrorCode: number; retErr: { type: string; message: string } } => {
  const retErr: { type: string; message: string; stack?: string } = {
    type: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : '',
  }

  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  const env = process.env['ENV']

  if ((env === 'dev' || env === 'local') && error instanceof Error && error.stack !== undefined) {
    retErr.stack = error.stack
  }

  return { httpErrorCode: 500, retErr }
}

const errorResponse = (
  error: unknown,
  baseHeaders: Record<string, string>,
  logger: ChatLogger,
): APIGatewayProxyResult => {
  const { httpErrorCode, retErr } = describeError(error)
  const rawMessage = error instanceof Error ? error.message : String(error)

  logger.error('CopilotKit error', { httpErrorCode, retErr, rawMessage })

  // Real error status: the AG-UI client surfaces a non-2xx payload in the chat UI. Internal
  // failure text stays in the logs.
  const message = httpErrorCode >= HTTP_SERVER_ERROR_MIN ? GENERIC_ERROR_MESSAGE : retErr.message

  return jsonResponse(httpErrorCode, JSON.stringify({ error: message, type: retErr.type }), baseHeaders)
}

// The buffered path: every frame in one body. Kept for any ingress without response streaming
// and as the offline contract the transport test drives; production uses `streamHandler`.
const serveBuffered = async (
  backend: HandlerBackend,
  event: ProxyEventLike,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const { logger } = backend

  logger.appendKeys({ awsRequestId: context?.awsRequestId || 'noRequestId' })

  const baseHeaders = buildBaseHeaders(event, context, backend.identityHeaders)

  try {
    const path = getPath(event)
    const method = getMethod(event)

    logger.info('CopilotKit request start', { path, method })

    const gate = await gateBeforeRuntime(event, path, method, baseHeaders, backend)

    if (gate.response) return gate.response

    const fetchHandler = await backend.getFetchHandler()

    // The whole runtime call runs inside the request context: `InProcessAgent.run` is invoked
    // deep inside `fetchHandler`, and the graph's tool node reads the identity from there.
    const { response, body } = await runWithRequestContext(
      {
        customerId: gate.customerId ?? '',
        awsRequestId: context?.awsRequestId || 'noRequestId',
        ...(gate.countTurn === undefined ? {} : { countTurn: gate.countTurn }),
      },
      async () => {
        const abortController = new AbortController()
        const runRequest = buildRequest(gate.event ?? event, abortController.signal)
        const runtimeResponse = await fetchHandler(runRequest)

        const drained = await readResponseBody(
          runtimeResponse,
          context,
          async () => {
            abortController.abort()

            // A failed stop must not mask the partial answer already collected.
            await stopRun(fetchHandler, event, runRequest, logger).catch((error: unknown) => {
              logger.error('CopilotKit stop after deadline failed', { error: String(error) })
            })
          },
          logger,
        )

        return { response: runtimeResponse, body: drained }
      },
    )

    logger.info('CopilotKit request end', { statusCode: response.status, bytes: body.length })

    // The runtime's own 5xx body carries the raw failure text (provider quota, model errors);
    // that stays in the logs, the traveller gets the generic message.
    if (response.status >= HTTP_SERVER_ERROR_MIN) {
      logger.error('CopilotKit runtime error', { statusCode: response.status, rawBody: body.slice(0, 2000) })

      return jsonResponse(response.status, GENERIC_ERROR_BODY, baseHeaders)
    }

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...baseHeaders,
      },
      body,
    }
  } catch (error) {
    return errorResponse(error, baseHeaders, logger)
  } finally {
    await settleWrites(logger)
    logger.resetKeys()
  }
}

// --- Streaming ingress (API Gateway `ResponseTransferMode: STREAM`) -----------------------------

// The edge-optimized API drops a stream idle for 30s; a comment frame (which the SSE parser
// ignores) keeps a slow tool round alive without inventing an AG-UI event.
const HEARTBEAT_MS = 10_000

export const HEARTBEAT_FRAME = `: keepalive${SSE_FRAME_SEPARATOR}`
const HEARTBEAT = Symbol('heartbeat')

export interface StreamMetadata {
  statusCode: number
  headers: Record<string, string>
}

/** Writes the status + headers prelude and hands back the body stream (`HttpResponseStream.from`). */
export type OpenResponseStream = (metadata: StreamMetadata) => Writable

// `drain` never fires on a stream destroyed without an error (the client went away mid-answer),
// so the wait also ends on `close`; the pump's next read then meets the ended stream.
const writeChunk = async (out: Writable, chunk: string): Promise<void> => {
  if (out.destroyed || out.write(chunk)) return

  await Promise.race([once(out, 'drain'), once(out, 'close')])
}

// A stream the client already closed (tab gone, Stop pressed) has nothing left to finish: waiting on
// it rejects with ERR_STREAM_PREMATURE_CLOSE, which is the traveller leaving, not a server fault.
const endStream = async (out: Writable, logger: ChatLogger, chunk?: string): Promise<void> => {
  if (out.destroyed) {
    logger.info('CopilotKit stream already closed by the client')

    return
  }

  if (chunk) await writeChunk(out, chunk)
  out.end()

  try {
    await finished(out)
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error

    logger.info('CopilotKit stream closed by the client before it ended')
  }
}

const headersOf = (result: APIGatewayProxyResult): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(result.headers ?? {}).map(([key, value]) => {
      return [key, String(value)]
    }),
  )
}

interface PumpResult {
  timedOut: boolean
  bytes: number
}

/**
 * Forwards the runtime's SSE body frame by frame. Only whole frames are written, so the stream
 * always sits on a frame boundary: that is what lets a heartbeat go out between frames and a
 * deadline append RUN_ERROR without a half-written frame before it (the AG-UI parser would
 * `JSON.parse` the fragment). The pending read survives a heartbeat — a second `read()` would
 * drop the chunk the first one resolves with.
 */
const pumpFrames = async (
  body: ReadableStream<unknown>,
  out: Writable,
  deadlineMs: number,
  heartbeat: boolean,
): Promise<PumpResult> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const deadline = createDeadline(deadlineMs)
  let pendingRead = reader.read()
  let tail = ''
  let bytes = 0

  const flushWholeFrames = async (): Promise<void> => {
    const boundary = tail.lastIndexOf(SSE_FRAME_SEPARATOR)

    if (boundary === -1) return

    const frames = tail.slice(0, boundary + SSE_FRAME_SEPARATOR.length)

    tail = tail.slice(boundary + SSE_FRAME_SEPARATOR.length)
    bytes += frames.length
    await writeChunk(out, frames)
  }

  try {
    for (;;) {
      const idle = createDeadline(heartbeat ? HEARTBEAT_MS : deadlineMs, HEARTBEAT)
      const next = await Promise.race([pendingRead, deadline.promise, idle.promise])

      idle.clear()

      if (next === TIMEOUT) return { timedOut: true, bytes }

      if (next === HEARTBEAT) {
        if (heartbeat) await writeChunk(out, HEARTBEAT_FRAME)
        continue
      }

      if (next.done) {
        tail += decoder.decode()

        if (tail.length > 0) {
          bytes += tail.length
          await writeChunk(out, tail)
        }

        return { timedOut: false, bytes }
      }

      tail += decodeChunk(next.value, decoder)
      await flushWholeFrames()
      pendingRead = reader.read()
    }
  } finally {
    deadline.clear()

    // A rejected cancel must not mask the result.
    void reader.cancel().catch(() => {
      return undefined
    })
  }
}

// LangSmith sends traces from a background queue; once the handler returns, Lambda freezes the
// sandbox and the batch waits for the next thaw, or dies with it. Capped: a slow trace endpoint must
// not hold the invocation (it bills) after the traveller already has the whole answer.
export const TRACE_FLUSH_CAP_MS = 2000

// The usage counter's writes, which the run starts without awaiting: one upsert each, so a second is
// generous; past it the write is logged lost rather than holding a billed invocation.
export const BACKGROUND_WRITES_CAP_MS = 1000

const settleWrites = async (logger: ChatLogger): Promise<void> => {
  if ((await settleBackgroundWrites(BACKGROUND_WRITES_CAP_MS)) === 'timed_out') {
    logger.warn('background writes still pending at the end of the invocation', { capMs: BACKGROUND_WRITES_CAP_MS })
  }
}

const flushTracesWith = async (logger: ChatLogger): Promise<void> => {
  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  if (process.env['LANGSMITH_TRACING'] !== 'true') return

  const cap = createDeadline(TRACE_FLUSH_CAP_MS)

  try {
    // Imported here: with tracing off the handler never loads the LangSmith client.
    const { awaitAllCallbacks } = await import('@langchain/core/callbacks/promises')

    const drains = [
      awaitAllCallbacks(),
      ...tracedCoreCopies().map((copy) => {
        return copy.awaitAllCallbacks()
      }),
    ]

    const result = await Promise.race([Promise.allSettled(drains), cap.promise])

    if (result === TIMEOUT) logger.warn('LangSmith trace flush hit its cap', { capMs: TRACE_FLUSH_CAP_MS })
  } catch (error) {
    logger.warn('LangSmith trace flush failed', { error: String(error) })
  } finally {
    cap.clear()
  }
}

/** For a Lambda that runs LangChain outside the chat handlers (a worker); absent, `consoleJsonLogger`. */
export const flushTraces = async ({ createLogger = consoleJsonLogger }: { createLogger?: ChatLoggerFactory } = {}) => {
  await flushTracesWith(createLogger(filename))
}

/**
 * The streaming twin of `handler`: same gate, same runtime, same identity headers, but each
 * AG-UI frame reaches the browser as the model produces it. The status line is committed when the
 * runtime answers, so a failure after that point can only end the stream with a RUN_ERROR frame.
 */
const serveStreamWith = async (
  backend: HandlerBackend,
  event: ProxyEventLike,
  context: Context,
  open: OpenResponseStream,
): Promise<void> => {
  const { logger } = backend

  logger.appendKeys({ awsRequestId: context?.awsRequestId || 'noRequestId' })

  const baseHeaders = buildBaseHeaders(event, context, backend.identityHeaders)
  let opened: Writable | undefined

  // Every path opens through here: `HttpResponseStream.from` may run once per invocation, and the
  // catch below must know whether it already did.
  const openOnce = (metadata: StreamMetadata): Writable => {
    opened = open(metadata)

    return opened
  }

  const endWithResult = async (result: APIGatewayProxyResult): Promise<void> => {
    await endStream(openOnce({ statusCode: result.statusCode, headers: headersOf(result) }), logger, result.body)
  }

  try {
    const path = getPath(event)
    const method = getMethod(event)

    logger.info('CopilotKit stream start', { path, method })

    const gate = await gateBeforeRuntime(event, path, method, baseHeaders, backend)

    if (gate.response) {
      await endWithResult(gate.response)

      return
    }

    const fetchHandler = await backend.getFetchHandler()

    await runWithRequestContext(
      {
        customerId: gate.customerId ?? '',
        awsRequestId: context?.awsRequestId || 'noRequestId',
        ...(gate.countTurn === undefined ? {} : { countTurn: gate.countTurn }),
      },
      async () => {
        const abortController = new AbortController()
        const runRequest = buildRequest(gate.event ?? event, abortController.signal)
        const response = await fetchHandler(runRequest)

        if (response.status >= HTTP_SERVER_ERROR_MIN) {
          const { text } = response.body
            ? await drainWithDeadline(response.body, resolveDeadlineMs(context))
            : { text: '' }

          logger.error('CopilotKit runtime error', { statusCode: response.status, rawBody: text.slice(0, 2000) })
          await endWithResult(jsonResponse(response.status, GENERIC_ERROR_BODY, baseHeaders))

          return
        }

        const contentType = response.headers.get('content-type') ?? 'text/event-stream'

        const out = openOnce({
          statusCode: response.status,
          headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', ...baseHeaders },
        })

        if (!response.body) {
          await endStream(out, logger)

          return
        }

        const isEventStream = contentType.startsWith('text/event-stream')
        const { timedOut, bytes } = await pumpFrames(response.body, out, resolveDeadlineMs(context), isEventStream)

        if (timedOut) {
          logger.error('CopilotKit run exceeded the response deadline', { bytes })
          abortController.abort()

          // A failed stop must not mask the partial answer already sent.
          await stopRun(fetchHandler, event, runRequest, logger).catch((error: unknown) => {
            logger.error('CopilotKit stop after deadline failed', { error: String(error) })
          })
          await endStream(out, logger, buildRunErrorFrame('The assistant took too long to respond.'))
        } else {
          await endStream(out, logger)
        }

        logger.info('CopilotKit stream end', { statusCode: response.status, bytes, timedOut })
      },
    )
  } catch (error) {
    const result = errorResponse(error, baseHeaders, logger)

    // Best effort either way: the failure may be the connection itself.
    const ending = opened
      ? // The status line is already out; the frame is the only channel left.
        endStream(opened, logger, buildRunErrorFrame(GENERIC_ERROR_MESSAGE))
      : endWithResult(result)

    await ending.catch(() => {
      return undefined
    })
  } finally {
    // After the stream has ended, so the traveller never waits on them.
    await settleWrites(logger)
    await flushTracesWith(logger)
    logger.resetKeys()
  }
}

export interface CopilotkitHandlers {
  /** The buffered path, for an ingress without response streaming. */
  handler: (event: ProxyEventLike, context: Context) => Promise<APIGatewayProxyResult>
  /** `streamHandler` without the Lambda wrapper, driven directly off Lambda (tests, local). */
  serveStream: (event: ProxyEventLike, context: Context, open: OpenResponseStream) => Promise<void>
  /** Undefined off the Lambda Node.js runtime. */
  streamHandler: ReturnType<typeof awslambda.streamifyResponse<ProxyEventLike>> | undefined
}

/**
 * The Lambda surface for one agent. Call it once at module scope in the host's handler entry: the
 * pair shares one runtime, built on the first request that passes the gate.
 */
export const createCopilotkitHandlers = (options: CopilotkitHandlerOptions): CopilotkitHandlers => {
  const createLogger = options.createLogger ?? consoleJsonLogger

  const backend: HandlerBackend = {
    getFetchHandler: memoizeFetchHandler({
      loadAgent: options.loadAgent,
      storage: options.storage,
      app: options.app,
      createLogger,
    }),
    identityHeaders: options.identityHeaders,
    storage: options.storage,
    session: options.session,
    logger: createLogger(filename),
    createLogger,
  }

  const serveStream: CopilotkitHandlers['serveStream'] = async (event, context, open) => {
    await serveStreamWith(backend, event, context, open)
  }

  return {
    handler: async (event, context) => {
      return serveBuffered(backend, event, context)
    },
    serveStream,
    // `awslambda` is a global of the Lambda Node.js runtime only (typed by @types/aws-lambda); elsewhere
    // this is undefined and `serveStream` is driven directly. The method is checked, not the global: a
    // dependency defines a bare `awslambda` object outside Lambda too.
    streamHandler:
      typeof awslambda === 'undefined' || typeof awslambda.streamifyResponse !== 'function'
        ? undefined
        : awslambda.streamifyResponse<ProxyEventLike>(async (event, responseStream, context) => {
            await serveStream(event, context, (metadata) => {
              return awslambda.HttpResponseStream.from(responseStream, { ...metadata })
            })
          }),
  }
}
