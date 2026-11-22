import { AbstractAgent, EventType } from '@ag-ui/client'
import type { AgentCapabilities, BaseEvent, RunAgentInput } from '@ag-ui/client'
import { Command } from '@langchain/langgraph'
import { Observable } from 'rxjs'
import type { Subscriber } from 'rxjs'

import { modelIdentityLabel } from '../langgraph/modelIdentity.js'
import { PROVIDER_CREDIT_EXHAUSTED_METRIC, isProviderBillingError } from '../langgraph/providerBilling.js'
import { consoleJsonLogger } from '../ports.js'
import type { ChatLogger, ChatLoggerFactory, RunFailure, RunFailureToolCall } from '../ports.js'
import { trackBackgroundWrite } from '../tools/backgroundWrites.js'
import { toSafeErrorMessage } from '../tools/redact.js'
import { guardA2uiMiddleware } from './a2ui.js'
import { attachedHistorySummary } from './historySummary.js'
import { toLangChainMessages } from './messageConversion.js'
import { currentRequestContext } from './requestContext.js'
import { traceRunIdOf } from './traceRunId.js'

export const RUN_ERROR_MESSAGE = 'The assistant could not answer that. Please try again.'
// One message for every refused resume — unknown, foreign, forged or expired id — so the answer
// says nothing about whether some other traveller's paused run exists.
export const RESUME_ERROR_MESSAGE = 'That confirmation is no longer open. Please ask again.'
/** `RUN_ERROR.code` of a run the model provider refused for billing; the browser shows an outage, not a retry. */
export const SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
const UNNAMED_UNAVAILABLE_MESSAGE = 'The assistant is temporarily unavailable. Please try again later.'

/** The outage notice, in the name of the product the traveller is talking to. */
export const serviceUnavailableMessage = (appName: string): string => {
  return `${appName}'s assistant is temporarily unavailable. Please try again later.`
}

class ResumeRejectedError extends Error {}

// What a failure may put in the logs. A failed drizzle query's message carries its parameters, and
// a checkpoint write's parameters are the whole serialised conversation (messages, plan, the
// traveller's name) — so such a message is replaced, never logged; secrets are redacted as for tools.
const describeFailure = (err: unknown): { errorName: string; rawMessage: string; code?: string } => {
  const message = toSafeErrorMessage(err)
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code

  return {
    errorName: err instanceof Error ? err.name : typeof err,
    rawMessage: /failed query|params:/iu.test(message) ? 'database query failed (parameters withheld)' : message,
    ...(typeof code === 'string' ? { code } : {}),
  }
}

// The runner copies the thrown error's message verbatim into the RUN_ERROR frame the browser
// renders, and a provider error carries its quota / model / account text. Keep that in the logs.
const toRunError = (err: unknown, logger: ChatLogger): Error => {
  if (err instanceof ResumeRejectedError) {
    logger.warn('travel agent resume refused', { reason: err.message })

    return new Error(RESUME_ERROR_MESSAGE)
  }

  logger.error('travel agent run failed', describeFailure(err))

  return new Error(RUN_ERROR_MESSAGE)
}

// A billing refusal ends the run with a coded RUN_ERROR the browser shows as an outage, and logs the
// one line the alarm counts; any other failure goes through `toRunError`. Emitted, not thrown: the
// runner turns a thrown error into a RUN_ERROR that keeps only its message, and the code is what
// tells the browser an outage from a failed turn.
const failRun = (
  err: unknown,
  emit: (event: BaseEvent) => void,
  subscriber: Subscriber<BaseEvent>,
  { logger, unavailableMessage }: { logger: ChatLogger; unavailableMessage: string },
): void => {
  if (!isProviderBillingError(err)) {
    subscriber.error(toRunError(err, logger))

    return
  }

  logger.error('model provider refused the run for billing', {
    metric: PROVIDER_CREDIT_EXHAUSTED_METRIC,
    ...describeFailure(err),
  })
  emit({ type: EventType.RUN_ERROR, message: unavailableMessage, code: SERVICE_UNAVAILABLE } as BaseEvent)
  subscriber.complete()
}

// Structural stand-in for `CompiledStateGraph<...>` so its generics don't leak into callers.
export interface StreamableGraph {
  streamEvents: (
    input: unknown,
    options: {
      version: 'v1' | 'v2'
      configurable?: Record<string, unknown>
      streamMode?: string | string[]
      recursionLimit?: number
      signal?: AbortSignal
      durability?: 'exit' | 'async' | 'sync'
      runId?: string
      runName?: string
      tags?: string[]
      metadata?: Record<string, unknown>
    },
  ) => AsyncIterable<LangGraphStreamEvent> | Promise<AsyncIterable<LangGraphStreamEvent>>
  /** Only read when the agent has `checkpoints`; a graph compiled without a checkpointer has none to give. */
  getState?: (config: { configurable: Record<string, unknown> }) => Promise<GraphStateSnapshot>
}

/** The part of LangGraph's `StateSnapshot` the agent reads. */
export interface GraphStateSnapshot {
  values?: unknown
  /** When the latest checkpoint was written; absent when the thread has none. */
  createdAt?: string
  tasks?: ReadonlyArray<{ interrupts?: ReadonlyArray<{ id?: string; value?: unknown }> }>
}

export type ResumeEntry = NonNullable<RunAgentInput['resume']>[number]

/** What the agent needs of the graph's checkpointer beyond what the graph itself does with it. */
export interface CheckpointStore {
  deleteThread: (threadId: string) => Promise<void>
  deleteStaleThreads: (threadPrefix: string, olderThan: Date) => Promise<void>
}

/**
 * Turns LangGraph `interrupt()` into AG-UI interrupts: a paused run ends with
 * `RUN_FINISHED.outcome = { type: 'interrupt' }`, and a later run carrying `RunAgentInput.resume`
 * continues it from the checkpoint. The graph must be compiled with the checkpointer `store` is.
 */
export interface CheckpointConfig {
  store: CheckpointStore
  /** The sentence the browser shows over the question. */
  describeInterrupt: (value: unknown) => string
  /**
   * The answer's shape for an `interrupt()` value, or `undefined` for a free-form answer. It goes out
   * as the AG-UI `Interrupt.responseSchema`, and a `resolved` payload that does not fit refuses the resume.
   */
  responseSchema?: (value: unknown) => InterruptResponseSchema | undefined
  /** The value `interrupt()` returns for this answer. The payload is browser-written: validate in the graph. */
  resumeValue: (entry: ResumeEntry) => unknown
}

/** A typed interrupt answer: zod's `safeParse` fits `parse` as is. */
export interface InterruptResponseSchema {
  /** JSON Schema (draft 2020-12) of the `resolved` payload. */
  jsonSchema: Record<string, unknown>
  parse: (payload: unknown) => { success: true; data: unknown } | { success: false }
}

/** How long a paused run can be resumed; also the age at which a traveller's leftover threads are swept. */
export const INTERRUPT_TTL_MS = 24 * 60 * 60 * 1000

/** At most one sweep of every owner's stale checkpoints per container in this window. */
export const STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1000

// Per container: the sweep scans the whole checkpoint table, and a stale thread only has to be gone
// eventually, not by the next run.
let lastStaleSweepAt = Number.NEGATIVE_INFINITY

// A run outside a Lambda invocation (a unit test) has no verified traveller.
const LOCAL_OWNER = 'local'

// LangGraph interrupt ids are XXH3 hex (`isXXH3`), the only key shape `Command.resume` maps by.
const LANGGRAPH_INTERRUPT_ID = /^[0-9a-f]{32}$/
// `<run that owns the checkpoint thread>~<LangGraph interrupt id>`. The thread itself is
// `<customerId>:<run id>` with the customer taken from the session, so an id naming another
// traveller's run resolves inside the caller's own namespace and finds nothing.
const INTERRUPT_ID = /^([\w-]{1,128})~([0-9a-f]{32})$/
const RUN_ID_PATTERN = /^[\w-]{1,128}$/

// The run id comes from the browser and becomes part of a primary key and of the interrupt id the
// browser must hand back: anything the resume parser would not accept is refused up front.
const usableRunId = (runId: string): string => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('run id is not usable as a thread key')

  return runId
}

const parseInterruptId = (id: string): { threadRunId: string; langgraphId: string } | undefined => {
  const [, threadRunId, langgraphId] = INTERRUPT_ID.exec(id) ?? []

  return threadRunId === undefined || langgraphId === undefined ? undefined : { threadRunId, langgraphId }
}

// AG-UI: a `resolved` payload is validated against the interrupt's `responseSchema`; the graph then
// receives the parsed answer. A cancel carries no payload, so there is nothing to check.
const typedAnswer = (checkpoints: CheckpointConfig, value: unknown, entry: ResumeEntry): ResumeEntry => {
  const schema = checkpoints.responseSchema?.(value)

  if (schema === undefined || entry.status !== 'resolved') return entry

  const parsed = schema.parse(entry.payload)

  if (!parsed.success) throw new ResumeRejectedError('payload does not match responseSchema')

  return { ...entry, payload: parsed.data }
}

const checkpointThreadId = (owner: string, threadRunId: string): string => {
  return `${owner}:${threadRunId}`
}

interface PendingInterrupt {
  id: string
  value: unknown
}

const pendingInterrupts = (snapshot: GraphStateSnapshot): PendingInterrupt[] => {
  return (snapshot.tasks ?? []).flatMap((task) => {
    return (task.interrupts ?? []).flatMap((pending) => {
      return typeof pending.id === 'string' && LANGGRAPH_INTERRUPT_ID.test(pending.id)
        ? [{ id: pending.id, value: pending.value }]
        : []
    })
  })
}

interface LangGraphStreamChunk {
  id?: string
  content?: unknown
  additional_kwargs?: { reasoning_content?: unknown }
  tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }>
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>
}

interface LangGraphStreamEvent {
  event: string
  name?: string
  run_id?: string
  data?: {
    chunk?: LangGraphStreamChunk
    output?: unknown
    input?: unknown
  }
  metadata?: { langgraph_node?: unknown } & Record<string, unknown>
}

export type RunProgressPhase = 'thinking' | 'researching'

/**
 * Turns graph node starts into one `ACTIVITY_*` progress message per run. `steps` names the
 * nodes that count as a step and the phase each reports; any other node is ignored.
 */
export interface RunProgressConfig {
  activityType: string
  maxSteps: number
  steps: Record<string, RunProgressPhase>
}

// An index signature because AG-UI types activity content as a plain record.
export interface RunProgressContent {
  [key: string]: unknown
  phase: RunProgressPhase | 'answering' | 'done'
  step: number
  maxSteps: number
  tools: string[]
}

/**
 * Graph channels mirrored to the browser as AG-UI shared state: read from `RunAgentInput.state`
 * on the way in, published as STATE_SNAPSHOT (run start) and STATE_DELTA (each node that
 * changes one) on the way out.
 */
export interface SharedStateConfig {
  keys: readonly string[]
  /** `RunAgentInput.state` → the graph input for `keys`. The browser is untrusted: validate here. */
  fromInput: (state: unknown) => Record<string, unknown>
  /**
   * The state as it will be once a tool call still streaming its arguments lands — what the
   * browser shows meanwhile. `undefined` = no projection yet. Reverted if the run fails.
   */
  predict?: (
    toolName: string,
    partialArgs: string,
    current: Record<string, unknown>,
  ) => Record<string, unknown> | undefined
  /**
   * Picks between the kept chat's state and the browser's (`fromInput`'s result) when a run starts, so
   * a tab left open across an edit made elsewhere does not write its stale copy back. Absent: the
   * browser's state is taken as it is.
   */
  reconcile?: (kept: Record<string, unknown>, input: Record<string, unknown>) => Record<string, unknown>
}

// The runner reads the kept chat, the agent reconciles it. Like the history summary, it rides on the
// agent instance the runtime made for the request, so it never travels on the wire where a caller could
// write it.
const keptChatStates = new WeakMap<object, Record<string, unknown>>()

export const attachKeptChatState = (agent: object, state: Record<string, unknown> | null | undefined): void => {
  if (state === null || state === undefined) keptChatStates.delete(agent)
  else keptChatStates.set(agent, state)
}

export interface InProcessAgentConfig {
  graph: StreamableGraph
  graphId: string
  recursionLimit: number
  /** Served as `/info.agents[id].capabilities`, which `useCapabilities` reads. */
  capabilities?: AgentCapabilities
  progress?: RunProgressConfig
  sharedState?: SharedStateConfig
  /** Absent: the run cannot pause, and a `resume` is refused. */
  checkpoints?: CheckpointConfig
  /** Kept with a failed run, so a failure can be traced to the prompt that produced it. */
  promptVersion?: string
  /**
   * Keeps a failed run whatever the trace sampling dropped. Best effort: a rejection is logged and the
   * run still ends with its RUN_ERROR. Absent: failures are only logged.
   */
  recordFailure?: (failure: RunFailure) => Promise<void>
  /** The product's name in the outage notice (`serviceUnavailableMessage`); absent, the notice names no product. */
  appName?: string
  /** Absent: `consoleJsonLogger`. */
  createLogger?: ChatLoggerFactory
}

interface TextContentBlock {
  type: 'text'
  text: string
}

const isTextContentBlock = (block: unknown): block is TextContentBlock => {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as { type: unknown }).type === 'text' &&
    'text' in block &&
    typeof (block as { text: unknown }).text === 'string'
  )
}

// LangChain streams content as a string or a block list; non-text blocks contribute ''.
const extractTextDelta = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((block) => {
      if (typeof block === 'string') {
        return block
      }

      return isTextContentBlock(block) ? block.text : ''
    })
    .join('')
}

interface ReasoningContentBlock {
  type?: unknown
  thinking?: unknown
  reasoning?: unknown
}

// Gemini (`includeThoughts`) streams `{ type: 'thinking', thinking }`; LangChain's standard
// block is `{ type: 'reasoning', reasoning }`.
const readBlockReasoning = (block: unknown): string => {
  if (block === null || typeof block !== 'object') return ''

  const { type, thinking, reasoning } = block as ReasoningContentBlock

  if (type === 'thinking' && typeof thinking === 'string') return thinking
  if (type === 'reasoning' && typeof reasoning === 'string') return reasoning

  return ''
}

// DeepSeek streams the chain of thought in `additional_kwargs.reasoning_content`.
const extractReasoningDelta = (chunk: LangGraphStreamChunk): string => {
  const providerReasoning = chunk.additional_kwargs?.reasoning_content
  const fromKwargs = typeof providerReasoning === 'string' ? providerReasoning : ''
  const fromBlocks = Array.isArray(chunk.content) ? chunk.content.map(readBlockReasoning).join('') : ''

  return fromKwargs + fromBlocks
}

const hasStringContent = (value: object): value is { content: string } => {
  return 'content' in value && typeof (value as { content: unknown }).content === 'string'
}

const stringifyToolResult = (output: unknown): string => {
  if (output === null || output === undefined) {
    return ''
  }

  if (typeof output === 'string') {
    return output
  }

  if (typeof output === 'object' && hasStringContent(output)) {
    return output.content
  }

  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

// `''` = cannot correlate; the caller skips the event.
const readToolCallId = (output: object): string => {
  if (!('tool_call_id' in output)) {
    return ''
  }

  return String((output as { tool_call_id: unknown }).tool_call_id ?? '')
}

// The suggestion engine sends `forwardedProps.toolChoice`; the graph decides whether to honour it.
const readToolChoice = (forwardedProps: unknown): unknown => {
  if (forwardedProps === null || typeof forwardedProps !== 'object') return undefined

  return (forwardedProps as { toolChoice?: unknown }).toolChoice
}

// How the run's root reads in LangSmith. Its Threads view groups runs by `metadata.thread_id`, which
// core otherwise copies from `configurable.thread_id` — one checkpoint thread per turn, so a chat would split.
const traceLabelsOf = (
  graphId: string,
  chatThreadId: string,
  toolChoice: unknown,
): { runName: string; tags: string[]; metadata: Record<string, unknown> } => {
  const runKind = toolChoice === undefined ? 'chat' : 'suggestion'

  return { runName: `${graphId}:${runKind}`, tags: [runKind], metadata: { thread_id: chatThreadId } }
}

// A graph node's own start event is the one named after the node; the runnables inside it
// share its `langgraph_node` metadata under other names.
const startedGraphNode = (ev: LangGraphStreamEvent): string | undefined => {
  const node = ev.metadata?.langgraph_node

  return typeof node === 'string' && node === ev.name ? node : undefined
}

interface TopLevelPatchOperation {
  op: 'add' | 'replace'
  path: string
  value: unknown
}

// Top-level keys only: each value (a progress field, a whole shared-state channel) is replaced
// as a unit, which keeps the patch trivially valid against whatever the browser holds.
const diffTopLevel = (previous: Record<string, unknown>, next: Record<string, unknown>): TopLevelPatchOperation[] => {
  return Object.entries(next)
    .filter(([key, value]) => {
      return JSON.stringify(previous[key]) !== JSON.stringify(value)
    })
    .map(([key, value]) => {
      return { op: key in previous ? ('replace' as const) : ('add' as const), path: `/${key}`, value }
    })
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const pickKeys = (source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => {
  return Object.fromEntries(
    keys
      .filter((key) => {
        return key in source
      })
      .map((key) => {
        return [key, source[key]]
      }),
  )
}

// AG-UI event builders: the SDK exposes no per-type constructors for `BaseEvent`,
// so each literal is asserted once here rather than at every emit site.
const runStarted = (threadId: string, runId: string): BaseEvent => {
  return { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent
}

const runFinished = (threadId: string, runId: string): BaseEvent => {
  return { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent
}

interface AgUiInterrupt {
  id: string
  reason: string
  message: string
  expiresAt: string
  metadata: Record<string, unknown>
  responseSchema?: Record<string, unknown>
}

const runInterrupted = (threadId: string, runId: string, interrupts: AgUiInterrupt[]): BaseEvent => {
  return { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'interrupt', interrupts } } as BaseEvent
}

const textMessageStart = (messageId: string): BaseEvent => {
  return { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent
}

const textMessageContent = (messageId: string, delta: string): BaseEvent => {
  return { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta } as BaseEvent
}

const textMessageEnd = (messageId: string): BaseEvent => {
  return { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent
}

// `THINKING_*` would be dropped: the client converts it only for agents at AG-UI ≤ 0.0.45.
const reasoningStart = (messageId: string): BaseEvent => {
  return { type: EventType.REASONING_START, messageId } as BaseEvent
}

const reasoningMessageStart = (messageId: string): BaseEvent => {
  return { type: EventType.REASONING_MESSAGE_START, messageId, role: 'reasoning' } as BaseEvent
}

const reasoningMessageContent = (messageId: string, delta: string): BaseEvent => {
  return { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta } as BaseEvent
}

const reasoningMessageEnd = (messageId: string): BaseEvent => {
  return { type: EventType.REASONING_MESSAGE_END, messageId } as BaseEvent
}

const reasoningEnd = (messageId: string): BaseEvent => {
  return { type: EventType.REASONING_END, messageId } as BaseEvent
}

const toolCallStart = (toolCallId: string, toolCallName: string, parentMessageId: string): BaseEvent => {
  return { type: EventType.TOOL_CALL_START, toolCallId, toolCallName, parentMessageId } as BaseEvent
}

const toolCallArgs = (toolCallId: string, delta: string): BaseEvent => {
  return { type: EventType.TOOL_CALL_ARGS, toolCallId, delta } as BaseEvent
}

const toolCallEnd = (toolCallId: string): BaseEvent => {
  return { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent
}

// AG-UI expects messageId === toolCallId on a result.
const toolCallResult = (toolCallId: string, content: string): BaseEvent => {
  return { type: EventType.TOOL_CALL_RESULT, messageId: toolCallId, toolCallId, content, role: 'tool' } as BaseEvent
}

const activitySnapshot = (messageId: string, activityType: string, content: RunProgressContent): BaseEvent => {
  return { type: EventType.ACTIVITY_SNAPSHOT, messageId, activityType, content, replace: true } as BaseEvent
}

const activityDelta = (messageId: string, activityType: string, patch: TopLevelPatchOperation[]): BaseEvent => {
  return { type: EventType.ACTIVITY_DELTA, messageId, activityType, patch } as BaseEvent
}

const stateSnapshot = (snapshot: Record<string, unknown>): BaseEvent => {
  return { type: EventType.STATE_SNAPSHOT, snapshot } as BaseEvent
}

const stateDelta = (delta: TopLevelPatchOperation[]): BaseEvent => {
  return { type: EventType.STATE_DELTA, delta } as BaseEvent
}

// Drives a local LangGraph via `streamEvents` and emits AG-UI events directly — no remote
// LangGraph host. Errors go to `subscriber.error`; CopilotSseRuntime turns them into an SSE error frame.
export class InProcessAgent extends AbstractAgent {
  private readonly graph: StreamableGraph
  public readonly graphId: string
  private readonly recursionLimit: number
  private readonly capabilities: AgentCapabilities | undefined
  private readonly progress: RunProgressConfig | undefined
  private readonly sharedState: SharedStateConfig | undefined
  private readonly checkpoints: CheckpointConfig | undefined
  public readonly promptVersion: string | undefined
  private readonly recordFailure: InProcessAgentConfig['recordFailure']
  private readonly appName: string | undefined
  private readonly unavailableMessage: string
  private readonly logger: ChatLogger
  private activeRun: AbortController | undefined

  // The runtime adds its A2UI middleware per request; a guard goes in with it so only a render tool's
  // result can paint a surface (`a2ui.ts`).
  override use(...middlewares: Parameters<AbstractAgent['use']>): this {
    return super.use(...guardA2uiMiddleware(middlewares))
  }

  constructor(config: InProcessAgentConfig) {
    super({
      agentId: config.graphId,
      description: `In-process LangGraph agent for ${config.graphId}.`,
    })
    this.graph = config.graph
    this.graphId = config.graphId
    this.recursionLimit = config.recursionLimit
    this.capabilities = config.capabilities
    this.progress = config.progress
    this.sharedState = config.sharedState
    this.checkpoints = config.checkpoints
    this.promptVersion = config.promptVersion
    this.recordFailure = config.recordFailure
    this.appName = config.appName
    this.unavailableMessage =
      config.appName === undefined ? UNNAMED_UNAVAILABLE_MESSAGE : serviceUnavailableMessage(config.appName)
    this.logger = (config.createLogger ?? consoleJsonLogger)('inProcessAgent')
  }

  // CopilotSseRuntime clones the agent per request and the default clone drops our fields
  // (→ "Cannot read 'streamEvents' of undefined" → 502). EVERY field added above goes here.
  override clone(): InProcessAgent {
    return new InProcessAgent({
      graph: this.graph,
      graphId: this.graphId,
      recursionLimit: this.recursionLimit,
      ...(this.capabilities === undefined ? {} : { capabilities: this.capabilities }),
      ...(this.progress === undefined ? {} : { progress: this.progress }),
      ...(this.sharedState === undefined ? {} : { sharedState: this.sharedState }),
      ...(this.checkpoints === undefined ? {} : { checkpoints: this.checkpoints }),
      ...(this.promptVersion === undefined ? {} : { promptVersion: this.promptVersion }),
      ...(this.recordFailure === undefined ? {} : { recordFailure: this.recordFailure }),
      ...(this.appName === undefined ? {} : { appName: this.appName }),
      // The clone is per request; it keeps its parent's logger rather than building one each time.
      createLogger: () => {
        return this.logger
      },
    })
  }

  // `/info` reads this off the registered agent; `{}` claims nothing rather than guessing.
  override async getCapabilities(): Promise<AgentCapabilities> {
    return this.capabilities ?? {}
  }

  // The base implementation is a no-op (only HttpAgent aborts anything), so the runner's
  // `stop()` would release the thread lock while the provider call kept running and billing.
  override abortRun(): void {
    this.activeRun?.abort()
    super.abortRun()
  }

  /**
   * The checkpointed run a `resume` answers, and the Command that continues it. Every entry must
   * name a still-open interrupt of ONE of the caller's own threads; anything else is refused whole.
   */
  private async prepareResume(
    resume: readonly ResumeEntry[],
    owner: string,
  ): Promise<{ threadRunId: string; command: Command; values: unknown }> {
    const { checkpoints, graph } = this

    if (!checkpoints || !graph.getState) throw new ResumeRejectedError('agent has no checkpointer')

    const answers = resume.map((entry) => {
      return { entry, id: parseInterruptId(entry.interruptId) }
    })

    const threadRunIds = new Set(
      answers.map(({ id }) => {
        return id?.threadRunId
      }),
    )

    const [threadRunId] = threadRunIds

    if (threadRunId === undefined || threadRunIds.size !== 1) throw new ResumeRejectedError('malformed interrupt id')

    const snapshot = await graph.getState({ configurable: { thread_id: checkpointThreadId(owner, threadRunId) } })

    const open = new Map(
      pendingInterrupts(snapshot).map((pending) => {
        return [pending.id, pending.value]
      }),
    )

    const pausedAt = snapshot.createdAt === undefined ? Number.NaN : Date.parse(snapshot.createdAt)

    if (Number.isNaN(pausedAt) || Date.now() - pausedAt > INTERRUPT_TTL_MS) {
      throw new ResumeRejectedError('no open checkpoint')
    }

    const resumeMap: Record<string, unknown> = {}

    for (const { entry, id } of answers) {
      if (id === undefined || !open.has(id.langgraphId)) throw new ResumeRejectedError('interrupt not open')

      resumeMap[id.langgraphId] = checkpoints.resumeValue(typedAnswer(checkpoints, open.get(id.langgraphId), entry))
    }

    return { threadRunId, command: new Command({ resume: resumeMap }), values: snapshot.values }
  }

  private async readInterrupts(threadId: string, threadRunId: string): Promise<AgUiInterrupt[]> {
    const { checkpoints, graph } = this

    if (!checkpoints || !graph.getState) return []

    const expiresAt = new Date(Date.now() + INTERRUPT_TTL_MS).toISOString()

    return pendingInterrupts(await graph.getState({ configurable: { thread_id: threadId } })).map((pending) => {
      const metadata = asRecord(pending.value)
      // eslint-disable-next-line dot-notation
      const kind = metadata['kind']

      const responseSchema = checkpoints.responseSchema?.(pending.value)?.jsonSchema

      return {
        id: `${threadRunId}~${pending.id}`,
        reason: typeof kind === 'string' ? kind : 'interrupt',
        message: checkpoints.describeInterrupt(pending.value),
        expiresAt,
        metadata: Object.keys(metadata).length > 0 ? metadata : { value: pending.value },
        ...(responseSchema === undefined ? {} : { responseSchema }),
      }
    })
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false

      const activeReasoning = new Set<string>()
      const activeText = new Set<string>()
      const activeToolCalls = new Map<string, string>()
      // OpenAI-compatible providers (DeepSeek) send the tool-call `id` only on the first
      // chunk; the args chunks carry just `index`. Remember the id per index so every
      // TOOL_CALL_ARGS targets the id that TOOL_CALL_START opened.
      const toolCallIdsByIndex = new Map<number, string>()

      const { progress } = this
      const progressMessageId = `progress-${input.runId}`
      let progressContent: RunProgressContent | undefined

      const emit = (event: BaseEvent): void => {
        if (!cancelled) {
          subscriber.next(event)
        }
      }

      const { sharedState } = this
      const browserShared = sharedState?.fromInput(input.state) ?? {}
      const keptChatState = keptChatStates.get(this)

      const sharedInput =
        sharedState?.reconcile && keptChatState ? sharedState.reconcile(keptChatState, browserShared) : browserShared

      // `committed` is what the graph has actually written; `published` what the browser holds,
      // which runs ahead of it while a prediction is showing. They differ from the start when
      // `reconcile` kept the saved state over the browser's: the first diff then corrects the tab.
      let committedState: Record<string, unknown> = { ...asRecord(input.state), ...sharedInput }
      let publishedState: Record<string, unknown> = { ...asRecord(input.state), ...browserShared }
      const streamingArgs = new Map<string, string>()

      const publishState = (next: Record<string, unknown>): void => {
        if (!sharedState) return

        const delta = diffTopLevel(publishedState, next)

        if (delta.length === 0) return

        emit(stateDelta(delta))
        publishedState = next
      }

      const handleNodeEnd = (ev: LangGraphStreamEvent): void => {
        if (!sharedState || startedGraphNode(ev) === undefined) return

        const written = pickKeys(asRecord(ev.data?.output), sharedState.keys)

        if (Object.keys(written).length === 0) return

        committedState = { ...committedState, ...written }
        publishState(committedState)
      }

      const predictFromArgs = (toolCallId: string, toolName: string, argsDelta: string): void => {
        if (!sharedState?.predict) return

        const args = (streamingArgs.get(toolCallId) ?? '') + argsDelta

        streamingArgs.set(toolCallId, args)

        const predicted = sharedState.predict(toolName, args, pickKeys(committedState, sharedState.keys))

        if (predicted !== undefined) publishState({ ...committedState, ...predicted })
      }

      const publishProgress = (next: RunProgressContent): void => {
        if (!progress) return

        if (progressContent === undefined) {
          emit(activitySnapshot(progressMessageId, progress.activityType, next))
        } else {
          const patch = diffTopLevel(progressContent, next)

          if (patch.length === 0) return

          emit(activityDelta(progressMessageId, progress.activityType, patch))
        }

        progressContent = next
      }

      const handleNodeStart = (ev: LangGraphStreamEvent): void => {
        const node = startedGraphNode(ev)
        const phase = node === undefined ? undefined : progress?.steps[node]

        if (!progress || phase === undefined) return

        publishProgress({
          phase,
          step: (progressContent?.step ?? 0) + 1,
          maxSteps: progress.maxSteps,
          tools: phase === 'researching' ? [] : (progressContent?.tools ?? []),
        })
      }

      // Every server tool the run started, for the failure record; a call still open when the run fails
      // stays `unfinished`.
      const toolCalls: RunFailureToolCall[] = []
      const openToolCalls = new Map<string, { call: RunFailureToolCall; startedAt: number }>()

      const trackToolStart = (ev: LangGraphStreamEvent): void => {
        const call = { name: ev.name ?? 'unknown', status: 'unfinished', durationMs: 0 }

        toolCalls.push(call)
        if (ev.run_id !== undefined) openToolCalls.set(ev.run_id, { call, startedAt: Date.now() })
      }

      const trackToolEnd = (ev: LangGraphStreamEvent): void => {
        const open = ev.run_id === undefined ? undefined : openToolCalls.get(ev.run_id)

        if (open === undefined) return

        const { status } = asRecord(ev.data?.output)

        open.call.status = typeof status === 'string' ? status : 'success'
        open.call.durationMs = Date.now() - open.startedAt
        openToolCalls.delete(ev.run_id ?? '')
      }

      const handleToolStart = (ev: LangGraphStreamEvent): void => {
        if (progressContent?.phase !== 'researching' || !ev.name || progressContent.tools.includes(ev.name)) return

        publishProgress({ ...progressContent, tools: [...progressContent.tools, ev.name] })
      }

      // Never left mid-step: the card would spin on a run that has ended.
      const finishProgress = (): void => {
        if (progressContent !== undefined) publishProgress({ ...progressContent, phase: 'done' })
      }

      const closeReasoning = (messageId: string): void => {
        if (!activeReasoning.delete(messageId)) return

        emit(reasoningMessageEnd(messageId))
        emit(reasoningEnd(messageId))
      }

      // The FE must never see a START without its END (called on end + on error).
      const closeOpenStreams = (): void => {
        for (const messageId of [...activeReasoning]) {
          closeReasoning(messageId)
        }

        for (const messageId of activeText) {
          emit(textMessageEnd(messageId))
        }

        activeText.clear()

        for (const toolCallId of activeToolCalls.keys()) {
          emit(toolCallEnd(toolCallId))
        }

        activeToolCalls.clear()
      }

      const startTextIfNeeded = (messageId: string): void => {
        if (activeText.has(messageId)) {
          return
        }

        activeText.add(messageId)
        emit(textMessageStart(messageId))

        if (progressContent !== undefined && progressContent.phase !== 'answering') {
          publishProgress({ ...progressContent, phase: 'answering' })
        }
      }

      // A separate message id: the reasoning renders as its own card above the reply.
      const streamReasoning = (chunkId: string, delta: string): void => {
        const messageId = `${chunkId}-reasoning`

        if (!activeReasoning.has(messageId)) {
          activeReasoning.add(messageId)
          emit(reasoningStart(messageId))
          emit(reasoningMessageStart(messageId))
        }

        emit(reasoningMessageContent(messageId, delta))
      }

      const handleChatModelStream = (ev: LangGraphStreamEvent): void => {
        const chunk = ev.data?.chunk

        if (!chunk) {
          return
        }

        const chunkId = chunk.id ?? ev.run_id ?? 'chunk'
        const reasoningDelta = extractReasoningDelta(chunk)
        const textDelta = extractTextDelta(chunk.content)
        const toolChunks = chunk.tool_call_chunks ?? []

        if (reasoningDelta.length > 0) {
          streamReasoning(chunkId, reasoningDelta)
        }

        // The model has stopped thinking once it answers or calls a tool.
        if (textDelta.length > 0 || toolChunks.length > 0) {
          closeReasoning(`${chunkId}-reasoning`)
        }

        if (textDelta.length > 0) {
          startTextIfNeeded(chunkId)
          emit(textMessageContent(chunkId, textDelta))
        }

        for (const toolChunk of toolChunks) {
          const index = toolChunk.index ?? 0
          const toolCallId = toolChunk.id ?? toolCallIdsByIndex.get(index) ?? `${chunkId}-${index}`

          toolCallIdsByIndex.set(index, toolCallId)

          if (!activeToolCalls.has(toolCallId) && toolChunk.name) {
            activeToolCalls.set(toolCallId, toolChunk.name)
            emit(toolCallStart(toolCallId, toolChunk.name, chunkId))
          }

          if (typeof toolChunk.args === 'string' && toolChunk.args.length > 0) {
            emit(toolCallArgs(toolCallId, toolChunk.args))
            predictFromArgs(toolCallId, activeToolCalls.get(toolCallId) ?? '', toolChunk.args)
          }
        }
      }

      // Load-bearing under LLM_PROVIDER=gemini (langgraph #4877): Gemini does not stream
      // `tool_call_chunks`; the call only appears complete on the final message. Emit START +
      // ARGS for any not yet surfaced. DeepSeek streams the chunks, so this dedupes to a no-op.
      const handleChatModelEnd = (ev: LangGraphStreamEvent): void => {
        const output = ev.data?.output

        if (output === null || typeof output !== 'object') {
          return
        }

        const toolCalls = (output as { tool_calls?: Array<{ id?: string; name?: string; args?: unknown }> }).tool_calls

        if (!Array.isArray(toolCalls)) {
          return
        }

        for (const call of toolCalls) {
          if (!call.name) {
            continue
          }

          const toolCallId = call.id ?? `${ev.run_id ?? 'call'}-${call.name}`

          if (activeToolCalls.has(toolCallId)) {
            continue
          }

          activeToolCalls.set(toolCallId, call.name)
          emit(toolCallStart(toolCallId, call.name, ev.run_id ?? toolCallId))

          const args = typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {})

          emit(toolCallArgs(toolCallId, args))
          predictFromArgs(toolCallId, call.name, args)
        }
      }

      // Server-side tools only; frontend tools end the run and execute in the browser.
      const handleToolEnd = (ev: LangGraphStreamEvent): void => {
        const output = ev.data?.output

        if (output === null || typeof output !== 'object') {
          return
        }

        const toolCallId = readToolCallId(output)

        if (toolCallId.length === 0) {
          return
        }

        emit(toolCallResult(toolCallId, stringifyToolResult(output)))
      }

      // Unsubscribe or `abortRun()` (runner stop) must cancel the provider call, not just
      // silence it — otherwise it keeps billing until the model finishes on its own.
      const abortController = new AbortController()

      this.activeRun = abortController

      // Read synchronously, while still on the request's async chain: the IIFE below is
      // started here but its later `await`s resume outside it.
      const requestContext = currentRequestContext()
      const { checkpoints } = this
      const owner = requestContext?.customerId ?? LOCAL_OWNER
      // The graph's thread: the run's own unless it resumes an earlier one. Without checkpoints
      // nothing is stored, and the AG-UI thread id is passed through as before.
      let threadRunId = input.runId
      let threadId = input.threadId

      // Never fails the run that is over: the rows are swept after `INTERRUPT_TTL_MS` anyway.
      const cleanUp = async (finishedThreadId: string | undefined): Promise<void> => {
        if (!checkpoints) return

        try {
          if (finishedThreadId !== undefined) await checkpoints.store.deleteThread(finishedThreadId)

          const now = Date.now()

          if (now - lastStaleSweepAt < STALE_SWEEP_INTERVAL_MS) return

          // Claimed before the await, so concurrent runs in this container do not sweep twice.
          lastStaleSweepAt = now
          // Every owner's, not only this caller's: a traveller who never comes back would otherwise
          // leave a paused copy of their conversation behind for good.
          await checkpoints.store.deleteStaleThreads('', new Date(now - INTERRUPT_TTL_MS))
        } catch (err) {
          this.logger.error('checkpoint clean-up failed', describeFailure(err))
        }
      }

      // Never masks the RUN_ERROR: a failed write is logged and the run fails as it would have. A refused
      // resume is not a failed run.
      const keepFailure = async (err: unknown): Promise<void> => {
        if (this.recordFailure === undefined || err instanceof ResumeRejectedError) return

        const { errorName, rawMessage, code } = describeFailure(err)
        const now = Date.now()

        for (const { call, startedAt } of openToolCalls.values()) call.durationMs = now - startedAt

        try {
          await this.recordFailure({
            traceRunId: traceRunIdOf(owner, input.threadId, input.runId),
            customerId: requestContext?.customerId ?? null,
            threadId: input.threadId,
            runId: input.runId,
            promptVersion: this.promptVersion ?? null,
            model: modelIdentityLabel(),
            errorCode: isProviderBillingError(err) ? SERVICE_UNAVAILABLE : (code ?? errorName),
            errorMessage: rawMessage,
            toolCalls,
          })
        } catch (recordErr) {
          this.logger.error('failed run not recorded', describeFailure(recordErr))
        }
      }

      // One checkpoint when the run stops (paused or finished), not one per step: only a pause is
      // ever resumed, and every write carries the whole history.
      const checkpointOptions = checkpoints ? { durability: 'exit' as const } : {}

      ;(async () => {
        emit(runStarted(input.threadId, input.runId))

        let hasGraphRun = false

        try {
          const frontendToolNames = new Set(
            (input.tools ?? []).map((frontendTool) => {
              return frontendTool.name
            }),
          )

          let graphInput: unknown = {
            messages: toLangChainMessages(input.messages, frontendToolNames, attachedHistorySummary(this)),
            ...sharedInput,
          }

          if ((input.resume ?? []).length > 0) {
            const resumed = await this.prepareResume(input.resume ?? [], owner)

            threadRunId = resumed.threadRunId
            graphInput = resumed.command
            // The paused run's plan, not whatever the browser shows: the browser may have edited it
            // meanwhile, and the resumed node applies its change to the checkpointed plan.
            committedState = { ...committedState, ...pickKeys(asRecord(resumed.values), sharedState?.keys ?? []) }
            publishedState = committedState
          }

          if (checkpoints) threadId = checkpointThreadId(owner, usableRunId(threadRunId))

          // The baseline every later STATE_DELTA patches: the browser's own state, validated.
          if (sharedState) {
            emit(stateSnapshot(publishedState))
            publishState(committedState)
          }

          hasGraphRun = true

          const toolChoice = readToolChoice(input.forwardedProps)

          const stream = await this.graph.streamEvents(graphInput, {
            ...traceLabelsOf(this.graphId, input.threadId, toolChoice),
            version: 'v2',
            ...checkpointOptions,
            recursionLimit: this.recursionLimit,
            signal: abortController.signal,
            // The trace's root id, so a traveller's vote on an answer can reach this trace
            // (`CustomerChatsRunner` keeps the same id beside the answer). Only a served request has
            // an owner to scope it with.
            ...(requestContext === undefined ? {} : { runId: traceRunIdOf(owner, input.threadId, input.runId) }),
            configurable: {
              thread_id: threadId,
              run_id: input.runId,
              // The conversation's AG-UI thread (`<owner>:<chatId>` behind `CustomerChatsRunner`),
              // unlike `thread_id`, which is per run when checkpoints are on.
              chatThreadId: input.threadId,
              frontendTools: input.tools ?? [],
              context: input.context ?? [],
              toolChoice,
              // Absent outside a Lambda invocation, so a graph unit test sees the same
              // configurable it always did.
              ...(requestContext === undefined
                ? {}
                : { customerId: requestContext.customerId, awsRequestId: requestContext.awsRequestId }),
            },
          })

          for await (const ev of stream) {
            if (cancelled) {
              break
            }

            switch (ev.event) {
              case 'on_chain_start':
                handleNodeStart(ev)
                break
              case 'on_chain_end':
                handleNodeEnd(ev)
                break
              case 'on_chat_model_stream':
                handleChatModelStream(ev)
                break
              case 'on_chat_model_end':
                handleChatModelEnd(ev)
                closeOpenStreams()
                toolCallIdsByIndex.clear()
                break
              case 'on_tool_start':
                trackToolStart(ev)
                handleToolStart(ev)
                break
              case 'on_tool_end':
                trackToolEnd(ev)
                handleToolEnd(ev)
                break
              default:
                break
            }
          }

          closeOpenStreams()
          finishProgress()
          // A prediction the graph never confirmed (a refused call, a change awaiting the
          // traveller's answer) must not stay on screen.
          publishState(committedState)

          const interrupts = await this.readInterrupts(threadId, threadRunId)

          if (interrupts.length > 0) {
            emit(runInterrupted(input.threadId, input.runId, interrupts))
            // Not awaited: the hourly sweep scans the whole table, and the reply must not wait on it.
            // The handler settles it once the response has ended.
            trackBackgroundWrite(cleanUp(undefined))
          } else {
            emit(runFinished(input.threadId, input.runId))
            trackBackgroundWrite(cleanUp(threadId))
          }

          subscriber.complete()
        } catch (err) {
          closeOpenStreams()
          finishProgress()
          publishState(committedState)
          // A failed run's checkpoint cannot be resumed from the browser; a refused resume never
          // reached the graph and leaves the thread it named alone.
          trackBackgroundWrite(cleanUp(hasGraphRun ? threadId : undefined))
          trackBackgroundWrite(keepFailure(err))
          failRun(err, emit, subscriber, { logger: this.logger, unavailableMessage: this.unavailableMessage })
        }
      })().catch((err: unknown) => {
        subscriber.error(toRunError(err, this.logger))
      })

      return () => {
        cancelled = true
        abortController.abort()
      }
    })
  }
}
