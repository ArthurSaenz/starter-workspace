import { EventType } from '@ag-ui/client'
import type { BaseEvent, Message } from '@ag-ui/client'
import { InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
  LocalThreadEndpointRecord,
} from '@copilotkit/runtime/v2'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Observable, ReplaySubject } from 'rxjs'

import { modelIdentityLabel } from '../langgraph/modelIdentity.js'
import { THREAD_RUN_STALE_SEC, consoleJsonLogger } from '../ports.js'
import type {
  ChatHistoryStore,
  ChatLogger,
  ChatLoggerFactory,
  ChatRating,
  KeptChat,
  RunFailureSink,
  RunLeaseStore,
  ThreadRunKey,
} from '../ports.js'
import { trackBackgroundWrite } from '../tools/backgroundWrites.js'
import {
  A2UI_ACTION_MESSAGE_NAME,
  A2UI_OPERATIONS_KEY,
  A2UI_SURFACE_ACTIVITY,
  a2uiRenderToolNames,
  a2uiSurfaceActivityId,
} from './a2ui.js'
import type { A2uiRenderToolConfig } from './a2ui.js'
import { attachHistorySummary, resolveHistorySummary } from './historySummary.js'
import type { HistorySummarizer } from './historySummary.js'
import { RESUME_ERROR_MESSAGE, attachKeptChatState } from './inProcessAgent.js'
import { droppedThroughTurnOf } from './messageConversion.js'
import type { HistorySummary } from './messageConversion.js'
import {
  isProgramSummaryMarker,
  isProgramSummaryMarkerId,
  programSummaryMarkerId,
  programSummaryMarkerOf,
} from './programSummaryMarker.js'
import { currentRequestContext } from './requestContext.js'
import { traceRunIdOf } from './traceRunId.js'
import { awaitingBrowserResults, trustedHistory } from './trustedHistory.js'

// apps/client/api `ServiceChats`: the id rule its GET and DELETE accept, so every chat written here
// can be reopened and deleted there; the caps, so neither writer keeps what the other would refuse.
const CHAT_ID_PATTERN = /^[\w-]{1,64}$/
const MAX_TRANSCRIPT_BYTES = 1_000_000

// Far above what a person keeps (the sidebar lists 50); a ceiling for a script, not a product limit.
export const MAX_CHATS_PER_TRAVELLER = 500
const MAX_STATE_BYTES = 64 * 1024
// apps/client/ui `titleOf`: the sidebar showed this title before the server wrote it.
const TITLE_MAX_LENGTH = 80
const UNTITLED_CHAT = 'New conversation'

// apps/client/api `MAX_LISTED_CHATS`: older chats stay stored but unlisted.
export const MAX_LISTED_THREADS = 50
export const REPLAY_FAILED_MESSAGE = 'The conversation could not be loaded.'
/** `RUN_ERROR.code` of a run refused because its chat cannot be kept; the browser offers a new chat. */
export const CONVERSATION_NOT_KEPT = 'CONVERSATION_NOT_KEPT'
/**
 * `CUSTOM` event name of a replay's thumbs: `value.ratings` maps an assistant message id to `up` or
 * `down`. The client app's `ChatHistorySync` reads it by the same name.
 */
export const CHAT_RATINGS_EVENT = 'chat_ratings'
export const CONVERSATION_NOT_KEPT_MESSAGE =
  "This conversation can't be saved any more. Start a new chat to keep going."
/** `RUN_ERROR.code` of a run whose chat was saved elsewhere (another tab) while it ran; the browser reloads it. */
export const CONVERSATION_CHANGED = 'CONVERSATION_CHANGED'
export const CONVERSATION_CHANGED_MESSAGE =
  'This conversation changed in another window, so this answer was not saved. Reload the chat to continue.'
/** `RUN_ERROR.code` of a run refused because the same chat is already answering (another tab or device). */
export const THREAD_RUNNING = 'THREAD_RUNNING'
export const THREAD_RUNNING_MESSAGE = 'This conversation is already answering in another window. Wait for it to finish.'
/**
 * `RUN_ERROR.code` of a `programSummaryOf` run refused because the run's summary is kept, being written
 * by another turn, or not this thread's to write. Final: the browser shows the run's results in place.
 */
export const SUMMARY_ALREADY_CLAIMED = 'summary_already_claimed'
/**
 * `RUN_ERROR.code` of a `programSummaryOf` run refused for now: the chat could not be read, or it
 * waits on the traveller (an open form or confirmation). The browser asks again once it is idle.
 */
export const SUMMARY_BLOCKED = 'summary_blocked'
/** `RUN_ERROR.code` of a regenerate that names a summary marker: only a traveller's question is answered again. */
export const REGENERATE_MARKER = 'regenerate_marker'
/**
 * `RUN_ERROR.code` of a follow-up (a form answer, a frontend tool's result) refused for now because its
 * chat could not be read: the browser may retry it.
 */
export const CHAT_UNREAD = 'chat_unread'
const CHAT_UNREAD_MESSAGE = 'This conversation could not be loaded just now. Try again in a moment.'
const SUMMARY_ALREADY_CLAIMED_MESSAGE = 'This search was already summed up.'
const SUMMARY_BLOCKED_MESSAGE = 'This search cannot be summed up yet.'
const REGENERATE_MARKER_MESSAGE = 'Only a question can be answered again.'

// A container serves one request at a time, so a stop lands where the run is not: the running turn
// polls `ai_chat_runs` this often for a stop asked anywhere (a few seconds of tokens at most).
export const RUN_BEAT_MS = 3000
export const STALE_RUN_SEC = THREAD_RUN_STALE_SEC
// A stopped run notices within one beat and saves what streamed before it frees the thread; a row asked
// to stop longer ago than this belongs to a run that will never release it.
export const STOP_GRACE_SEC = 5
// A follow-up sent right after Stop waits here for the stopped run to free the thread, instead of the
// traveller seeing THREAD_RUNNING for a run they already stopped.
export const CLAIM_WAIT_MS = 4000
const CLAIM_POLL_MS = 500

// Errors a reused socket raises when the pooler or the network dropped it while the container slept:
// the query never ran, so it is safe to send again on a fresh connection.
const CONNECTION_RESET_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
])

// Threads whose finished turn was not written, per container: a later turn on them would answer on
// a history missing that turn. Bounded like the in-memory store; a mark lost to eviction or to
// another container leaves that turn undetected, never refuses a healthy one.
const MAX_UNKEPT_MARKS = 1000

// A summary that failed for a dropped block is not asked for again on every turn — each attempt can
// hold the answer back by `HISTORY_SUMMARY_TIMEOUT_MS`. Per container, so another one may retry sooner.
export const HISTORY_SUMMARY_RETRY_MS = 15 * 60_000

// The in-memory store only backs a run while it streams (the stop route, a concurrent second run);
// history is read from `customer_chats`. Its store is per process, so it is kept small: one run per
// thread and a few MB instead of 1000 threads and 512 MB a warm container would otherwise hold.
const IN_MEMORY_LIMITS = { maxThreads: 100, maxRunsPerThread: 1, maxBytes: 16 * 1024 ** 2 }

export interface CustomerThreadRecord extends LocalThreadEndpointRecord {
  lastRunAt: string
}

export interface CustomerThreadList {
  threads: CustomerThreadRecord[]
  nextCursor: null
}

interface StoredInterrupt {
  expiresAt?: unknown
}

interface SummaryRefusal {
  code: typeof SUMMARY_ALREADY_CLAIMED | typeof SUMMARY_BLOCKED
  reason: 'unread' | 'marker_kept' | 'blocked' | 'claimed' | 'no_traveller' | 'cas_error'
}

interface TrustedRun {
  messages: Message[]
  regenerated: boolean
  /** The run answers a question (`trustedHistory`), so it spends one of the day's turns. */
  newTurn: boolean
  /**
   * The finished background run a `programSummaryOf` turn sums up, with its marker already appended to
   * `messages`; `refusal` when the kept chat alone shows it cannot run (no claim is tried then).
   */
  summary?: { runId: string; refusal?: SummaryRefusal }
  /**
   * The kept chat's `updatedAt` when the run started: the save must find it unchanged. `null` for a new
   * chat, absent when the store could not be read; neither guards the save.
   */
  keptUpdatedAt?: string | null
  /**
   * The kept chat's shared state, which the agent's `reconcile` may prefer over a stale tab's. Not
   * `keptState`: that is the save's own function below.
   */
  keptChatState?: Record<string, unknown> | null
  /** Why the run is refused with `CONVERSATION_NOT_KEPT`; logged, never sent. */
  notKept?: string
  /** The kept chat could not be read: the run's history is the browser's user turns alone. */
  unread?: true
  /**
   * Makes the summary of the turns the model input drops, a model call of its own, so it is asked for
   * only once the run is counted; absent when the run may not have one.
   */
  summarise?: () => Promise<HistorySummary | undefined>
  /** The summary of the turns the model input drops; absent when it drops none or none could be made. */
  historySummary?: HistorySummary
}

// `changed`: another writer saved the chat while the run went on, so the answer was not written.
type PersistOutcome = 'kept' | 'not_kept' | 'changed'

/** The lease `startSummaryRun` granted this run; released or completed exactly once. */
interface SummaryClaim {
  runId: string
  claimedAt: string
}

// A run is driven by `InMemoryAgentRunner` (its stop and concurrency rules), keyed per traveller so
// one traveller can neither stop nor wait on another's thread. The chat is upserted before the
// response stream ends because a Lambda is frozen once it answers. A run that errors or is stopped
// writes nothing: the chat keeps its last finished turn, and the browser resends the unanswered
// message (accepted as a new user turn, `trustedHistory`) with its next one. The runtime's local thread routes (`listThreads`,
// `getThreadMessages|Events|State`, `clearThreads`) are synchronous and know no caller, so they
// answer nothing here; the Lambda serves the list through `listCustomerThreads` and 404s the rest.
/**
 * The runtime's `AgentRunner` on `customer_chats`: one store for a traveller's conversations, and the
 * server is its only writer. A run that ends with RUN_FINISHED — an answer or a question (an
 * interrupt) — keeps the agent's transcript, shared state and open interrupts under the thread id.
 * `connect` replays the caller's kept chat (RUN_STARTED, MESSAGES_SNAPSHOT, the thumbs, STATE_SNAPSHOT,
 * RUN_FINISHED with the open interrupts); an unknown id and another traveller's id both replay
 * nothing. Ownership is the repository's `user_id` guard, with the traveller taken from the verified
 * session (`currentRequestContext`), never from the request.
 */
export class CustomerChatsRunner extends InMemoryAgentRunner {
  private readonly history: ChatHistoryStore
  private readonly runLeases: RunLeaseStore
  private readonly runFailures: RunFailureSink
  private readonly appName: string
  // A `ThreadRecord` names an organisation (CopilotKit Intelligence is multi-tenant); there is one here.
  private readonly organizationId: string
  private readonly agentIds: ReadonlySet<string>
  private readonly defaultAgentId: string
  private readonly activeRuns = new Map<string, string>()
  private readonly stoppedRuns = new Set<string>()
  // Accepted but not yet handed to `super.run` (the trusted history is still being read): a stop in
  // that window has no run to abort, so it is held here and honoured before the run starts.
  private readonly startingRuns = new Set<string>()
  private readonly unkeptThreads = new Set<string>()
  private readonly summaryFailures = new Map<string, { throughTurn: number; retryAt: number }>()
  private readonly summarizeHistory: HistorySummarizer | undefined
  private readonly renderToolNames: ReadonlySet<string>
  // Runs another run took the thread over from: their answer must not overwrite the newer one.
  private readonly supersededRuns = new Set<string>()
  private readonly runBeatMs: number
  private readonly claimWaitMs: number
  private readonly logger: ChatLogger

  // Without `summarizeHistory`, turns `capHistory` drops are dropped unsummarised. `a2ui` is the
  // runtime's own A2UI options: absent, no call is a render call.
  constructor(options: {
    storage: { history: ChatHistoryStore; runLeases: RunLeaseStore; runFailures: RunFailureSink }
    /** The speaker of a summary marker, and the organisation of every thread record. */
    app: { name: string; organizationId: string }
    agentIds: readonly [string, ...string[]]
    summarizeHistory?: HistorySummarizer
    a2ui?: A2uiRenderToolConfig
    runBeatMs?: number
    claimWaitMs?: number
    /** Absent: `consoleJsonLogger`. */
    createLogger?: ChatLoggerFactory
  }) {
    super(IN_MEMORY_LIMITS)
    this.history = options.storage.history
    this.runLeases = options.storage.runLeases
    this.runFailures = options.storage.runFailures
    this.appName = options.app.name
    this.organizationId = options.app.organizationId
    this.agentIds = new Set(options.agentIds)
    this.defaultAgentId = options.agentIds[0]
    this.summarizeHistory = options.summarizeHistory
    this.renderToolNames = options.a2ui === undefined ? new Set() : a2uiRenderToolNames(options.a2ui)
    this.runBeatMs = options.runBeatMs ?? RUN_BEAT_MS
    this.claimWaitMs = options.claimWaitMs ?? CLAIM_WAIT_MS
    this.logger = (options.createLogger ?? consoleJsonLogger)('customerChatsRunner')
  }

  override run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const owner = currentOwner()
    const countTurn = currentRequestContext()?.countTurn
    const scopedThreadId = scopeThread(owner, request.threadId)
    const runId = request.input.runId
    const runKey = `${scopedThreadId}:${runId}`
    const events = new ReplaySubject<BaseEvent>(Infinity)
    let failed = false
    let finished: BaseEvent | undefined
    let heldError: BaseEvent | undefined
    let beat: ReturnType<typeof setInterval> | undefined

    // Only a kept thread is tracked across containers: an id client-api cannot address keeps nothing.
    const durableKey: ThreadRunKey | undefined =
      owner !== '' && CHAT_ID_PATTERN.test(request.threadId)
        ? { customerId: owner, threadId: request.threadId, runId }
        : undefined

    // Settled by the Lambda before it freezes (`settleBackgroundWrites`): a run stopped at the response
    // deadline ends only after its stream has, and its save and thread release happen on that end.
    trackBackgroundWrite(
      new Promise<void>((resolve) => {
        events.subscribe({
          complete: () => {
            resolve()
          },
          error: () => {
            resolve()
          },
        })
      }),
    )

    this.activeRuns.set(scopedThreadId, runId)
    this.startingRuns.add(runKey)

    const settle = () => {
      clearInterval(beat)
      this.startingRuns.delete(runKey)

      if (this.activeRuns.get(scopedThreadId) === runId) this.activeRuns.delete(scopedThreadId)

      return this.stoppedRuns.delete(runKey)
    }

    // Ends a run that never reached the agent; RUN_STARTED first, as every run's stream begins.
    const endEarly = (last: BaseEvent) => {
      settle()
      events.next({ type: EventType.RUN_STARTED, threadId: request.threadId, runId } as BaseEvent)
      events.next(last)
      events.complete()
    }

    // A stop asked on another container reaches this run here; so does a newer run that took the
    // thread over (this one's row went stale), whose answer this one must not overwrite.
    const watchForStop = (key: ThreadRunKey) => {
      beat = setInterval(() => {
        void this.beatRun(key).then((state) => {
          if (state === 'running') return

          clearInterval(beat)

          if (state === 'superseded') this.supersededRuns.add(runKey)

          this.logger.info('run stopped from another container', { threadId: request.threadId, reason: state })
          this.stoppedRuns.add(runKey)
          void super.stop({ threadId: scopedThreadId, runId })
        })
      }, this.runBeatMs)
    }

    let summaryClaim: SummaryClaim | undefined

    // Every exit of a run holding a claim passes here once, before its terminal event goes out: only a
    // kept summary completes it, anything else frees it for the next attempt. A release lost to a frozen
    // Lambda is covered by the lease (`SUMMARY_LEASE_MS`) running out.
    const settleSummaryClaim = async (exit: PersistOutcome | 'error' | 'start_failed' | 'stopped' | 'unfinished') => {
      const claim = summaryClaim

      summaryClaim = undefined

      if (claim === undefined) return

      await (exit === 'kept' ? this.completeSummary(claim) : this.releaseSummary(claim, exit))
    }

    const start = ({ messages, regenerated, keptUpdatedAt, keptChatState, historySummary }: TrustedRun) => {
      // A superseded run's save must not land on a chat the newer run may already have written.
      const guarded = typeof keptUpdatedAt === 'string'

      // The agent builds the model input from its own messages (`prepareRunAgentInput`), and they are
      // what `persist` keeps: both must be the trusted history, not the browser's copy.
      request.agent.setMessages(messages)
      attachHistorySummary(request.agent, historySummary)
      attachKeptChatState(request.agent, keptChatState)

      const trusted = { ...request, input: { ...request.input, messages }, threadId: scopedThreadId }

      // Subscribed here, not by the response: the chat is written even when the browser went away.
      super.run(trusted).subscribe({
        next: (event) => {
          if (event.type === EventType.RUN_ERROR) {
            failed = true
            trackBackgroundWrite(this.keepFailure(owner, request, event))
          }

          // A summary turn's failure is held until its claim is freed: the browser retries on it, and a
          // retry that reached the claim first would be refused as already claimed.
          if (event.type === EventType.RUN_ERROR && summaryClaim !== undefined) {
            heldError = event

            return
          }

          // Held until the chat is written: a save refused as `changed` ends the run with RUN_ERROR
          // instead, and AG-UI allows nothing after RUN_FINISHED.
          if (event.type === EventType.RUN_FINISHED) {
            finished = event

            return
          }

          events.next(event)
        },
        error: (error: unknown) => {
          settle()
          this.supersededRuns.delete(runKey)
          if (durableKey) trackBackgroundWrite(this.releaseRun(durableKey))

          const claimSettled = settleSummaryClaim('error')

          trackBackgroundWrite(claimSettled)
          void claimSettled.then(() => {
            events.error(error)
          })
        },
        complete: () => {
          const stopped = settle()
          const superseded = this.supersededRuns.delete(runKey)
          // A stopped run keeps what the traveller saw stream in, so the next turn's history matches
          // the screen; a run stopped before it added anything keeps nothing. A superseded run (it missed
          // its stop) is a stopped one too, and keeps its part only through the guarded save.
          const answeredSomething = request.agent.messages.length > messages.length
          const keep = owner !== '' && !failed && (!stopped || answeredSomething) && (!superseded || guarded)

          if (owner !== '' && !keep) {
            this.logger.info('chat not kept: the run did not finish', { failed, stopped, superseded })
          }

          if (stopped && keep) this.logger.info('chat kept up to where the run was stopped')

          const persisted: Promise<PersistOutcome> =
            keep && finished
              ? this.persist(owner, request, finished, { regenerated, keptUpdatedAt })
              : Promise.resolve('not_kept')

          // Released before RUN_FINISHED goes out: the browser may send the next run (a frontend tool's
          // result) the moment it reads it.
          const released = persisted.then(async (outcome) => {
            await settleSummaryClaim(keep && !finished ? 'unfinished' : outcome)
            if (durableKey) await this.releaseRun(durableKey)

            return outcome
          })

          trackBackgroundWrite(released)

          void released.then((outcome) => {
            if (outcome === 'changed') {
              events.next({
                type: EventType.RUN_ERROR,
                message: CONVERSATION_CHANGED_MESSAGE,
                code: CONVERSATION_CHANGED,
              } as BaseEvent)
            } else if (heldError) {
              events.next(heldError)
            } else if (finished) {
              events.next(finished)
            }

            events.complete()
          })
        },
      })

      if (durableKey) watchForStop(durableKey)
    }

    // Refuses a run before it reaches the agent, freeing the thread first.
    const refuse = (code: string, message: string) => {
      if (durableKey) trackBackgroundWrite(this.releaseRun(durableKey))
      endEarly({ type: EventType.RUN_ERROR, message, code } as BaseEvent)
    }

    const refuseSummary = (runId: string, { code, reason }: SummaryRefusal) => {
      this.logger.info('summary refused', { threadId: request.threadId, programRunId: runId, reason })
      refuse(code, code === SUMMARY_BLOCKED ? SUMMARY_BLOCKED_MESSAGE : SUMMARY_ALREADY_CLAIMED_MESSAGE)
    }

    const endStopped = () => {
      if (durableKey) trackBackgroundWrite(this.releaseRun(durableKey))
      endEarly({ type: EventType.RUN_FINISHED, threadId: request.threadId, runId } as BaseEvent)
    }

    // Whether the run may go on to the agent; a summary turn goes on only holding its claim. The claim
    // is taken last, after every refusal that needs none, so none of those can leave one behind; the run
    // stays in `startingRuns` meanwhile, so a stop during the claim is held, not lost.
    const takeSummaryClaim = async (summary: NonNullable<TrustedRun['summary']>): Promise<boolean> => {
      if (summary.refusal !== undefined) {
        refuseSummary(summary.runId, summary.refusal)

        return false
      }

      const claimed = await this.claimSummaryRun(owner, request.threadId, summary.runId)

      if (typeof claimed !== 'string') {
        refuseSummary(summary.runId, claimed)

        return false
      }

      summaryClaim = { runId: summary.runId, claimedAt: claimed }
      this.logger.info('program summary started', { threadId: request.threadId, programRunId: summary.runId })

      if (!this.stoppedRuns.has(runKey)) return true

      await settleSummaryClaim('stopped')
      endStopped()

      return false
    }

    // The Lambda let this run in as a follow-up, uncounted; the trusted history found a question in it,
    // so it is counted here. Whether the run may go on; a refused or stopped one has been ended.
    //
    // Unread, the kept chat cannot show whether it asks anything: the strict history keeps the body's
    // user turns and drops the form answer, so running it would charge a form answer as a new question,
    // and running it uncounted would let any body through free while the store is down. It is refused
    // uncounted instead, and the traveller retries.
    const countUncountedTurn = async ({ unread, newTurn }: TrustedRun): Promise<boolean> => {
      if (countTurn === undefined) return true

      if (unread === true) {
        this.logger.warn('run refused: a follow-up whose chat could not be read', { threadId: request.threadId })
        refuse(CHAT_UNREAD, CHAT_UNREAD_MESSAGE)

        return false
      }

      if (!newTurn) return true

      const refusal = await countTurn()

      if (refusal !== undefined) {
        this.logger.warn('run refused: a follow-up body carried a new question past the daily quota', {
          threadId: request.threadId,
          code: refusal.code,
        })
        refuse(refusal.code, refusal.message)

        return false
      }

      if (!this.stoppedRuns.has(runKey)) return true

      endStopped()

      return false
    }

    void this.startRun(owner, request, durableKey).then(async (trustedRun) => {
      if (trustedRun === 'thread_running') {
        this.logger.warn('run refused: the thread is already answering on another container', {
          threadId: request.threadId,
        })
        endEarly({ type: EventType.RUN_ERROR, message: THREAD_RUNNING_MESSAGE, code: THREAD_RUNNING } as BaseEvent)

        return
      }

      if (this.stoppedRuns.has(runKey)) {
        endStopped()

        return
      }

      if (trustedRun.notKept !== undefined) {
        this.logger.warn('run refused: its chat cannot be kept', {
          threadId: request.threadId,
          reason: trustedRun.notKept,
        })
        refuse(CONVERSATION_NOT_KEPT, CONVERSATION_NOT_KEPT_MESSAGE)

        return
      }

      const regenerateFrom = forwardedIdOf(request.input.forwardedProps, 'regenerateFrom')

      // A summary turn alongside a regenerate would cut the launch reply and leave the marker right after the question.
      if (
        regenerateFrom !== undefined &&
        (isProgramSummaryMarkerId(regenerateFrom) ||
          forwardedIdOf(request.input.forwardedProps, 'programSummaryOf') !== undefined)
      ) {
        this.logger.warn('run refused: regenerate names a summary marker', { threadId: request.threadId })
        refuse(REGENERATE_MARKER, REGENERATE_MARKER_MESSAGE)

        return
      }

      if (!(await countUncountedTurn(trustedRun))) return

      const historySummary = await trustedRun.summarise?.()

      // The summary can take seconds; a stop sent meanwhile is held in `stoppedRuns`, as during the read.
      if (this.stoppedRuns.has(runKey)) {
        endStopped()

        return
      }

      if (trustedRun.summary !== undefined && !(await takeSummaryClaim(trustedRun.summary))) return

      this.startingRuns.delete(runKey)

      try {
        start(historySummary === undefined ? trustedRun : { ...trustedRun, historySummary })
      } catch (error) {
        // `super.run` refuses a second concurrent run on the thread by throwing.
        settle()
        if (durableKey) trackBackgroundWrite(this.releaseRun(durableKey))
        await settleSummaryClaim('start_failed')
        events.error(error)
      }
    })

    return events.asObservable()
  }

  override connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const owner = currentOwner()

    return new Observable<BaseEvent>((subscriber) => {
      Promise.all([this.readChat(owner, request.threadId), this.readRatings(owner, request.threadId)]).then(
        ([chat, ratings]) => {
          for (const event of chat ? replayOf(request.threadId, chat, ratings) : []) subscriber.next(event)
          subscriber.complete()
        },
        (error: unknown) => {
          this.logger.error('chat replay failed', failureOf(error))
          subscriber.error(new Error(REPLAY_FAILED_MESSAGE))
        },
      )
    })
  }

  override isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return super.isRunning({ ...request, threadId: scopeThread(currentOwner(), request.threadId) })
  }

  // Marked before the abort: the run may settle before `super.stop` resolves. A run on another
  // container is asked through `ai_chat_runs`; its heartbeat aborts it within `RUN_BEAT_MS`.
  override async stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const owner = currentOwner()
    const scopedThreadId = scopeThread(owner, request.threadId)
    const runId = this.activeRuns.get(scopedThreadId)
    const marks = runId !== undefined && (request.runId === undefined || request.runId === runId)

    // Keyed by the owner's thread too: run ids come from browsers and need not be unique across them.
    if (marks) this.stoppedRuns.add(`${scopedThreadId}:${runId}`)

    // Still reading its history: `run` sees the mark before it starts the agent.
    if (marks && this.startingRuns.has(`${scopedThreadId}:${runId}`)) return true

    const stopped = await super.stop({ ...request, threadId: scopedThreadId })

    if (marks && !stopped) this.stoppedRuns.delete(`${scopedThreadId}:${runId}`)

    if (stopped === true || owner === '' || !CHAT_ID_PATTERN.test(request.threadId)) return stopped

    try {
      return await this.runLeases.requestStop(owner, request.threadId, request.runId)
    } catch (error) {
      this.logger.error('run stop not recorded', { threadId: request.threadId, ...failureOf(error) })

      return false
    }
  }

  /** The caller's chats, newest first, as CopilotKit `ThreadRecord`s; nothing for an agent not served here. */
  async listCustomerThreads(agentId: string | null, limit: number): Promise<CustomerThreadList> {
    const owner = currentOwner()

    if (owner === '' || (agentId !== null && !this.agentIds.has(agentId))) return { threads: [], nextCursor: null }

    const listed = await this.history.listChats(owner, Math.min(Math.max(1, limit), MAX_LISTED_THREADS))
    const threadAgentId = agentId ?? this.defaultAgentId

    return {
      threads: listed.map((chat) => {
        const updatedAt = toIso(chat.updatedAt)

        return {
          id: chat.id,
          name: chat.title,
          agentId: threadAgentId,
          organizationId: this.organizationId,
          createdById: owner,
          archived: false,
          createdAt: toIso(chat.createdAt),
          updatedAt,
          lastRunAt: updatedAt,
        }
      }),
      nextCursor: null,
    }
  }

  override listThreads(): ReturnType<InMemoryAgentRunner['listThreads']> {
    return []
  }

  override getThreadMessages(): Message[] {
    return []
  }

  override getThreadEvents(): BaseEvent[] {
    return []
  }

  override getThreadState(): Record<string, unknown> | null {
    return null
  }

  // The in-memory store is shared by every traveller's running thread; nothing a caller may wipe.
  override clearThreads(): void {
    return undefined
  }

  // The agent records the failures it sees with their tools; this row stands for one that failed outside
  // it, so it never replaces the agent's. A refused resume is not a failed run.
  private async keepFailure(owner: string, request: AgentRunnerRunRequest, event: BaseEvent): Promise<void> {
    const { message, code } = event as BaseEvent & { message?: unknown; code?: unknown }

    if (message === RESUME_ERROR_MESSAGE) return

    const { promptVersion } = request.agent as { promptVersion?: unknown }

    try {
      await this.runFailures.record(
        {
          traceRunId: traceRunIdOf(owner, request.threadId, request.input.runId),
          customerId: owner === '' ? null : owner,
          threadId: request.threadId,
          runId: request.input.runId,
          promptVersion: typeof promptVersion === 'string' ? promptVersion : null,
          model: modelIdentityLabel(),
          errorCode: typeof code === 'string' ? code : null,
          errorMessage: typeof message === 'string' ? message : 'RUN_ERROR',
          toolCalls: [],
        },
        { keepExisting: true },
      )
    } catch (err) {
      this.logger.error('failed run not recorded', { errorName: err instanceof Error ? err.name : typeof err })
    }
  }

  // Fails open: a store that cannot be read must not stop a traveller from chatting; the in-memory
  // guard still holds on this container.
  private async claimRun(key: ThreadRunKey): Promise<boolean> {
    const giveUpAt = Date.now() + this.claimWaitMs

    try {
      for (;;) {
        if (await this.runLeases.claimThread(key, STALE_RUN_SEC, STOP_GRACE_SEC)) return true
        if (Date.now() + CLAIM_POLL_MS > giveUpAt) return false

        await new Promise((resolve) => {
          setTimeout(resolve, CLAIM_POLL_MS)
        })
      }
    } catch (error) {
      this.logger.error('run not tracked across containers', { threadId: key.threadId, ...failureOf(error) })

      return true
    }
  }

  private async beatRun(key: ThreadRunKey): Promise<'running' | 'stop_requested' | 'superseded'> {
    try {
      return await this.runLeases.beatThread(key)
    } catch (error) {
      this.logger.warn('run heartbeat failed', { threadId: key.threadId, ...failureOf(error) })

      return 'running'
    }
  }

  // A row left behind goes stale after `STALE_RUN_SEC` and is taken over then.
  private async releaseRun(key: ThreadRunKey): Promise<void> {
    try {
      await this.runLeases.releaseThread(key)
    } catch (error) {
      this.logger.warn('run not released', { threadId: key.threadId, ...failureOf(error) })
    }
  }

  // `null` covers a foreign, unsettled, reported, completed or live-claimed run alike; a store that
  // cannot be read refuses for now rather than running a summary nothing de-duplicates.
  private async claimSummaryRun(owner: string, threadId: string, runId: string): Promise<string | SummaryRefusal> {
    if (owner === '') return { code: SUMMARY_ALREADY_CLAIMED, reason: 'no_traveller' }

    try {
      const claimedAt = await this.runLeases.claimSummary(runId, owner, threadId)

      return claimedAt ?? { code: SUMMARY_ALREADY_CLAIMED, reason: 'claimed' }
    } catch (error) {
      this.logger.error('summary claim not taken', {
        threadId,
        programRunId: runId,
        reason: 'cas_error',
        ...failureOf(error),
      })

      return { code: SUMMARY_BLOCKED, reason: 'cas_error' }
    }
  }

  // A completion that is not recorded leaves the kept marker as the guard: the next `programSummaryOf`
  // for the run is refused on it before any claim is tried.
  private async completeSummary(claim: SummaryClaim): Promise<void> {
    try {
      if (await this.runLeases.completeSummary(claim.runId, claim.claimedAt)) {
        this.logger.info('summary completed', { programRunId: claim.runId })

        return
      }

      this.logger.warn('summary completion not recorded', { programRunId: claim.runId, reason: 'claim_moved' })
    } catch (error) {
      this.logger.warn('summary completion not recorded', { programRunId: claim.runId, ...failureOf(error) })
    }
  }

  private async releaseSummary(claim: SummaryClaim, exit: string): Promise<void> {
    try {
      await this.runLeases.releaseSummary(claim.runId, claim.claimedAt)
      this.logger.info('summary claim released', { programRunId: claim.runId, exit })
    } catch (error) {
      this.logger.warn('summary claim not released', { programRunId: claim.runId, exit, ...failureOf(error) })
    }
  }

  private async startRun(
    owner: string,
    request: AgentRunnerRunRequest,
    durableKey: ThreadRunKey | undefined,
  ): Promise<TrustedRun | 'thread_running'> {
    if (durableKey && !(await this.claimRun(durableKey))) return 'thread_running'

    return this.trustedRun(owner, request)
  }

  private async readChat(owner: string, threadId: string): Promise<KeptChat | null> {
    if (owner === '' || !CHAT_ID_PATTERN.test(threadId)) return null

    return this.history.getChat(owner, threadId)
  }

  // Read beside the chat, never before it. A vote is decoration: a failed read reopens the chat with
  // its thumbs unpressed rather than failing the replay.
  private async readRatings(owner: string, threadId: string): Promise<Record<string, ChatRating>> {
    if (owner === '' || !CHAT_ID_PATTERN.test(threadId)) return {}

    try {
      const votes = await this.history.listRatings(owner, threadId)

      return Object.fromEntries(
        votes.map((vote) => {
          return [vote.messageId, vote.rating]
        }),
      )
    } catch (error) {
      this.logger.warn('chat ratings read failed; the chat reopens without its thumbs', failureOf(error))

      return {}
    }
  }

  // One retry when a warm container's socket was dropped while it slept: the read never ran.
  private async readChatRetrying(owner: string, threadId: string): Promise<KeptChat | null> {
    try {
      return await this.readChat(owner, threadId)
    } catch (error) {
      if (!isConnectionReset(error)) throw error

      this.logger.warn('chat history read hit a dropped connection; retrying once', { threadId, ...failureOf(error) })

      return this.readChat(owner, threadId)
    }
  }

  // A store that cannot be read leaves the run on the strictest history (the new user turn only)
  // rather than on the browser's word; `persist` still refuses to shorten the kept transcript.
  private async trustedRun(owner: string, request: AgentRunnerRunRequest): Promise<TrustedRun> {
    const { threadId } = request
    let kept: KeptChat | null = null
    let isRead = false

    try {
      kept = await this.readChatRetrying(owner, threadId)
      isRead = true
    } catch (error) {
      this.logger.error('chat history not read: the run sees only the new turn', { threadId, ...failureOf(error) })
    }

    const regenerateFrom = forwardedIdOf(request.input.forwardedProps, 'regenerateFrom')

    const { messages, dropped, regenerated, newTurn, summary } = runHistoryOf(
      isRead,
      kept,
      request,
      regenerateFrom,
      this.renderToolNames,
      this.appName,
    )

    if (Object.keys(dropped).length > 0) {
      this.logger.warn('browser history not trusted: messages dropped', { threadId, kept: kept !== null, dropped })
    }

    if (regenerateFrom !== undefined && !regenerated) {
      this.logger.info('regenerate cut nothing: the turn is not the last kept user turn', { threadId })
    }

    let notKept: string | undefined

    try {
      notKept = owner === '' || !isRead ? undefined : await this.notKeptReason(owner, request, kept, messages)
    } catch (error) {
      // The run is answered; `persist` repeats the count and refuses the write itself.
      this.logger.error('chat keepability not checked', { threadId, ...failureOf(error) })
    }

    // A refused summary turn never reaches a model, the summariser's included.
    const summarise =
      notKept === undefined && summary?.refusal === undefined && kept !== null
        ? this.historySummaryOf.bind(this, owner, request, kept, messages)
        : undefined

    return {
      messages,
      regenerated,
      newTurn,
      ...(summary === undefined ? {} : { summary }),
      ...(isRead
        ? { keptUpdatedAt: kept?.updatedAt ?? null, keptChatState: kept?.state ?? null }
        : { unread: true as const }),
      ...(notKept === undefined ? {} : { notKept }),
      ...(summarise === undefined ? {} : { summarise }),
    }
  }

  // Fails open: a summary that cannot be made or kept leaves the run on the cut history alone, as
  // before summaries existed. A fresh one is kept at once, so a run that then fails does not pay for
  // it again; the chat's `updatedAt` is untouched, so this run's guarded save still goes through.
  private async historySummaryOf(
    owner: string,
    request: AgentRunnerRunRequest,
    kept: KeptChat,
    messages: readonly Message[],
  ): Promise<HistorySummary | undefined> {
    const summarize = this.summarizeHistory

    if (summarize === undefined || owner === '') return undefined

    const { threadId } = request

    const frontendToolNames = new Set(
      (request.input.tools ?? []).map((frontendTool) => {
        return frontendTool.name
      }),
    )

    const keptSummary =
      kept.historySummary !== null && kept.historySummaryThroughTurn !== null && kept.historySummaryFingerprint !== null
        ? {
            text: kept.historySummary,
            throughTurn: kept.historySummaryThroughTurn,
            fingerprint: kept.historySummaryFingerprint,
          }
        : null

    const failureKey = scopeThread(owner, threadId)
    const failure = this.summaryFailures.get(failureKey)
    const throughTurn = droppedThroughTurnOf(messages, frontendToolNames)
    const isBackingOff = failure !== undefined && failure.throughTurn === throughTurn && Date.now() < failure.retryAt
    let resolved: Awaited<ReturnType<typeof resolveHistorySummary>>

    try {
      resolved = await resolveHistorySummary({
        messages,
        frontendToolNames,
        kept: keptSummary,
        summarize: isBackingOff ? undefined : summarize,
        customerId: owner,
        threadId: failureKey,
        appName: this.appName,
      })
    } catch (error) {
      this.logger.warn('history summary not made: older turns are dropped unsummarised', {
        threadId,
        ...failureOf(error),
      })
      this.markSummaryFailed(failureKey, throughTurn)

      return undefined
    }

    if (resolved?.isFresh === true) {
      this.summaryFailures.delete(failureKey)

      try {
        await this.history.setHistorySummary(owner, threadId, {
          text: resolved.summary.text,
          throughTurn: resolved.summary.throughTurn,
          fingerprint: resolved.fingerprint,
        })
      } catch (error) {
        this.logger.error('history summary not kept', { threadId, ...failureOf(error) })
      }
    }

    return resolved?.summary
  }

  private markSummaryFailed(failureKey: string, throughTurn: number): void {
    this.summaryFailures.delete(failureKey)
    this.summaryFailures.set(failureKey, { throughTurn, retryAt: Date.now() + HISTORY_SUMMARY_RETRY_MS })

    for (const oldest of this.summaryFailures.keys()) {
      if (this.summaryFailures.size <= MAX_UNKEPT_MARKS) break
      this.summaryFailures.delete(oldest)
    }
  }

  // Why this run's answer could not join its chat, so the traveller is told now rather than this
  // turn (and every later one) being answered on a history missing what they see on screen. A
  // browser answer missing from the row proves nothing alone: a stopped run keeps nothing either.
  private async notKeptReason(
    owner: string,
    request: AgentRunnerRunRequest,
    kept: KeptChat | null,
    trusted: readonly Message[],
  ): Promise<string | undefined> {
    const keptIds = new Set(
      (kept?.messages ?? []).map((message) => {
        return (message as Message).id
      }),
    )

    const unkept = request.input.messages.filter((message) => {
      return (message.role === 'assistant' || message.role === 'tool') && !keptIds.has(message.id)
    })

    if (kept === null && !CHAT_ID_PATTERN.test(request.threadId)) return 'the id cannot be kept'

    if (kept === null && (await this.history.countChats(owner)) >= MAX_CHATS_PER_TRAVELLER) {
      return 'the traveller already keeps the maximum number of chats'
    }

    const showsUnkeptAnswer = unkept.some((message) => {
      return message.role === 'assistant'
    })

    if (showsUnkeptAnswer && this.unkeptThreads.has(scopeThread(owner, request.threadId))) {
      return 'an earlier answer on screen was not kept'
    }

    if (byteLength(trusted) + byteLength(unkept) > MAX_TRANSCRIPT_BYTES) return 'the transcript is over the ceiling'

    return undefined
  }

  private markUnkept(owner: string, threadId: string): void {
    this.unkeptThreads.add(scopeThread(owner, threadId))

    for (const oldest of this.unkeptThreads) {
      if (this.unkeptThreads.size <= MAX_UNKEPT_MARKS) break
      this.unkeptThreads.delete(oldest)
    }
  }

  // Never fails the run that is over: the traveller already has the answer on screen.
  private async persist(
    owner: string,
    request: AgentRunnerRunRequest,
    finished: BaseEvent,
    { regenerated, keptUpdatedAt }: { regenerated: boolean; keptUpdatedAt: string | null | undefined },
  ): Promise<PersistOutcome> {
    const { threadId, agent } = request

    if (!CHAT_ID_PATTERN.test(threadId)) return 'not_kept'

    const messages = transcriptToKeep(agent.messages)

    if (messages.length === 0) return 'not_kept'

    if (byteLength(messages) > MAX_TRANSCRIPT_BYTES) {
      this.logger.warn('chat not kept: transcript over the ceiling', { threadId })
      this.markUnkept(owner, threadId)

      return 'not_kept'
    }

    try {
      // A chat's transcript only ever grows. A shorter one means the browser never got the kept
      // history back (a failed connect) and sent a turn on top of nothing: writing it would erase
      // the conversation the traveller can still reopen.
      const kept = await this.readChat(owner, threadId)

      // Every fresh thread id makes a new row of up to a megabyte; a loop minting ids must not be
      // able to grow a traveller's share of the table without bound.
      if (kept === null && (await this.history.countChats(owner)) >= MAX_CHATS_PER_TRAVELLER) {
        this.logger.warn('chat not kept: the traveller already keeps the maximum number of chats', { threadId })
        this.markUnkept(owner, threadId)

        return 'not_kept'
      }

      // Not marked unkept: the browser reloads the chat on CONVERSATION_CHANGED, and the next turn's
      // trusted history drops this unkept answer anyway.
      const guarded = typeof keptUpdatedAt === 'string'

      if (guarded && kept?.updatedAt !== keptUpdatedAt) {
        this.logger.warn('chat not kept: saved elsewhere while the run went on', { threadId })

        return 'changed'
      }

      // A regenerated turn replaces the kept answer after the turn it re-answers, so it may be shorter.
      if (kept !== null && !regenerated && kept.messages.length > messages.length) {
        this.logger.warn('chat not kept: the turn would shorten the kept transcript', {
          threadId,
          kept: kept.messages.length,
          sent: messages.length,
        })
        this.markUnkept(owner, threadId)

        return 'not_kept'
      }

      const saved = await this.history.saveChat(
        {
          id: threadId,
          customerId: owner,
          title: titleOf(messages),
          messages,
          state: keptState(agent.state, threadId, this.logger),
          interrupts: interruptsOf(finished),
          traceRunIds: traceRunIdsOf(kept, messages, traceRunIdOf(owner, threadId, request.input.runId)),
        },
        guarded ? { expectedUpdatedAt: keptUpdatedAt } : undefined,
      )

      // Saved elsewhere between the read above and this write.
      if (!saved && guarded) {
        this.logger.warn('chat not kept: saved elsewhere while the run went on', { threadId })

        return 'changed'
      }

      // The id is another traveller's chat: nothing written, and the caller is told nothing either.
      if (!saved) {
        this.logger.warn('chat not kept: the id belongs to another traveller', { threadId })
        this.markUnkept(owner, threadId)

        return 'not_kept'
      }

      for (const surface of newSurfaceOutcomes(kept?.messages ?? [], messages)) {
        this.logger.info('a2ui surface', { threadId, ...surface })
      }

      return 'kept'
    } catch (error) {
      this.logger.error('chat not kept: write failed', { threadId, ...failureOf(error) })
      this.markUnkept(owner, threadId)

      return 'not_kept'
    }
  }
}

// A run outside a Lambda invocation (a unit test driving the runtime) has no traveller and keeps nothing.
const currentOwner = (): string => {
  return currentRequestContext()?.customerId ?? ''
}

const scopeThread = (owner: string, threadId: string): string => {
  return `${owner}:${threadId}`
}

// `regenerateFrom` (apps/client/ui `ChatRunControl.retry`): the id of the user turn a regenerate or retry
// answers again. `programSummaryOf` (apps/client/ui `summarise`): the finished background run whose
// summary turn the browser asks for.
const forwardedIdOf = (forwardedProps: unknown, key: 'regenerateFrom' | 'programSummaryOf'): string | undefined => {
  if (forwardedProps === null || typeof forwardedProps !== 'object') return undefined

  const value = (forwardedProps as Record<string, unknown>)[key]

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// Why the kept chat alone rules a summary turn out, checked before any claim is taken. An unread chat
// can show neither a kept marker nor an open form, so it is refused for now rather than trusted.
const summaryRefusalOf = (
  isRead: boolean,
  kept: KeptChat | null,
  runId: string,
  renderToolNames: ReadonlySet<string>,
): SummaryRefusal | undefined => {
  if (!isRead) return { code: SUMMARY_BLOCKED, reason: 'unread' }

  const keptMessages = (kept?.messages ?? []) as Message[]
  const markerId = programSummaryMarkerId(runId)

  const isMarkerKept = keptMessages.some((message) => {
    return message.id === markerId && isProgramSummaryMarker(message)
  })

  if (isMarkerKept) return { code: SUMMARY_ALREADY_CLAIMED, reason: 'marker_kept' }

  if (
    awaitingBrowserResults(keptMessages, renderToolNames).size > 0 ||
    openInterrupts(kept?.interrupts ?? null).length > 0
  ) {
    return { code: SUMMARY_BLOCKED, reason: 'blocked' }
  }

  return undefined
}

// The trusted history, plus the summary turn's marker when `programSummaryOf` asks for one and the kept
// chat does not rule it out. The server writes the marker from the run id alone, so it is the same
// bytes the browser shows.
const runHistoryOf = (
  isRead: boolean,
  kept: KeptChat | null,
  request: AgentRunnerRunRequest,
  regenerateFrom: string | undefined,
  renderToolNames: ReadonlySet<string>,
  appName: string,
): ReturnType<typeof trustedHistory> & Pick<TrustedRun, 'summary'> => {
  const history = trustedHistory(kept, request.input.messages, {
    renderToolNames,
    ...(regenerateFrom === undefined ? {} : { regenerateFrom }),
  })

  const runId = forwardedIdOf(request.input.forwardedProps, 'programSummaryOf')

  if (runId === undefined) return history

  const refusal = summaryRefusalOf(isRead, kept, runId, renderToolNames)

  if (refusal !== undefined) return { ...history, summary: { runId, refusal } }

  return { ...history, messages: [...history.messages, programSummaryMarkerOf(appName, runId)], summary: { runId } }
}

/**
 * What of a finished run's messages is the conversation. The run's progress line is hidden once the
 * run ends (`agentProgressRenderers`), so it is not kept; an A2UI surface is part of the answer, and
 * a reopened chat would show its call with nothing drawn.
 *
 * `@ag-ui/a2ui-middleware` 0.0.16 replaces the agent's messages with its own view of the run before
 * it continues one ("Automatic tool completion" in its README). That view holds the message it
 * writes for a button press, which it shows nobody, and may hold a result the event stream adds
 * again; whether the view outlives the run depends on event order, so neither is ever kept.
 */
export const transcriptToKeep = (messages: readonly Message[]): Message[] => {
  const answered = new Set<string>()

  return messages.filter((message) => {
    if (message.role === 'activity') return message.activityType === A2UI_SURFACE_ACTIVITY
    if (message.role === 'user') return !A2UI_ACTION_MESSAGE_NAME.test(message.name ?? '')
    if (message.role !== 'tool') return true
    if (answered.has(message.toolCallId)) return false

    answered.add(message.toolCallId)

    return true
  })
}

export interface A2uiSurfaceOutcome {
  /** The `version` of the surface's operations (`v0.9`, `1.0`); absent on a failure, which carries none. */
  protocolVersion?: string
  status: 'painted' | 'failed'
  /** The middleware's code on the render call's result (`a2ui_render_failed`), when it gave one. */
  code?: string
}

const parsedCodeOf = (content: unknown): string | undefined => {
  if (typeof content !== 'string') return undefined

  try {
    const { code } = (JSON.parse(content) ?? {}) as { code?: unknown }

    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/**
 * How each surface this run added to the chat ended, for the one log line that tells a painted
 * comparison from a refused one on prod. Never its content: that is the traveller's conversation.
 * A surface the chat already kept unchanged is not this run's, and one still building is no outcome.
 */
export const newSurfaceOutcomes = (kept: readonly unknown[], messages: readonly Message[]): A2uiSurfaceOutcome[] => {
  const before = new Map(
    (kept as Message[]).map((message) => {
      return [message.id, JSON.stringify(message.content)]
    }),
  )

  const codes = new Map(
    messages.flatMap((message): Array<[string, string | undefined]> => {
      return message.role === 'tool' ? [[a2uiSurfaceActivityId(message.toolCallId), parsedCodeOf(message.content)]] : []
    }),
  )

  return messages.flatMap((message): A2uiSurfaceOutcome[] => {
    if (message.role !== 'activity' || message.activityType !== A2UI_SURFACE_ACTIVITY) return []
    if (before.get(message.id) === JSON.stringify(message.content)) return []

    const content = (message.content ?? {}) as { status?: unknown; [A2UI_OPERATIONS_KEY]?: unknown }
    const operations = content[A2UI_OPERATIONS_KEY]
    const code = codes.get(message.id)
    const coded = code === undefined ? {} : { code }

    if (Array.isArray(operations) && operations.length > 0) {
      const { version } = (operations[0] ?? {}) as { version?: unknown }

      return [{ ...(typeof version === 'string' ? { protocolVersion: version } : {}), status: 'painted', ...coded }]
    }

    return content.status === 'failed' ? [{ status: 'failed', ...coded }] : []
  })
}

const replayOf = (threadId: string, chat: KeptChat, ratings: Record<string, ChatRating>): BaseEvent[] => {
  const runId = randomUUID()
  const interrupts = openInterrupts(chat.interrupts)

  return [
    { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
    { type: EventType.MESSAGES_SNAPSHOT, messages: chat.messages } as BaseEvent,
    ...(Object.keys(ratings).length > 0
      ? [{ type: EventType.CUSTOM, name: CHAT_RATINGS_EVENT, value: { ratings } } as BaseEvent]
      : []),
    ...(chat.state ? [{ type: EventType.STATE_SNAPSHOT, snapshot: chat.state } as BaseEvent] : []),
    (interrupts.length > 0
      ? { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'interrupt', interrupts } }
      : { type: EventType.RUN_FINISHED, threadId, runId }) as BaseEvent,
  ]
}

// A question past its `expiresAt` can no longer be resumed (its checkpoint is swept, see
// `INTERRUPT_TTL_MS`); asking it again would only fail the answer.
const openInterrupts = (stored: unknown[] | null, now = Date.now()): unknown[] => {
  return (stored ?? []).filter((interrupt) => {
    const expiresAt = (interrupt as StoredInterrupt | null)?.expiresAt

    return typeof expiresAt !== 'string' || Date.parse(expiresAt) > now
  })
}

const interruptsOf = (finished: BaseEvent): unknown[] | null => {
  const { outcome } = finished as { outcome?: { type?: unknown; interrupts?: unknown } }

  return outcome?.type === 'interrupt' && Array.isArray(outcome.interrupts) && outcome.interrupts.length > 0
    ? outcome.interrupts
    : null
}

/**
 * The kept answers' trace ids, plus this run's for each answer it added; entries of messages no longer
 * in the transcript (a regenerated turn) are dropped.
 */
const traceRunIdsOf = (
  kept: KeptChat | null,
  messages: readonly Message[],
  traceRunId: string,
): Record<string, string> => {
  const known = kept?.traceRunIds ?? {}
  const ids: Record<string, string> = {}

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    ids[message.id] = known[message.id] ?? traceRunId
  }

  return ids
}

const keptState = (state: unknown, threadId: string, logger: ChatLogger): Record<string, unknown> | null => {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return null
  if (Object.keys(state).length === 0) return null

  if (byteLength(state) > MAX_STATE_BYTES) {
    logger.warn('chat state not kept: over the ceiling', { threadId })

    return null
  }

  return state as Record<string, unknown>
}

/** The first thing the traveller typed; a user message's content is a string or AG-UI input parts. */
export const titleOf = (messages: readonly Message[]): string => {
  for (const message of messages) {
    if (message.role !== 'user' || isProgramSummaryMarker(message)) continue

    const text = textOf(message.content).replace(/\s+/g, ' ').trim()

    if (text) return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text
  }

  return UNTITLED_CHAT
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part: unknown) => {
      return typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
        ? part.text
        : ''
    })
    .join(' ')
}

const byteLength = (value: unknown): number => {
  return Buffer.byteLength(JSON.stringify(value))
}

// Postgres hands back `2026-10-07 20:01:04.123+00`; a `ThreadRecord` carries ISO strings.
const toIso = (timestamp: string): string => {
  const parsed = new Date(timestamp)

  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toISOString()
}

const isConnectionReset = (error: unknown): boolean => {
  const codeOf = (value: unknown): unknown => {
    return (value as { code?: unknown } | null)?.code
  }

  const code = codeOf(error) ?? codeOf((error as { cause?: unknown } | null)?.cause)

  return typeof code === 'string' && CONNECTION_RESET_CODES.has(code)
}

// Never the message: a failed query's text carries its parameters, the traveller's conversation.
const failureOf = (error: unknown): { errorName: string; code?: string } => {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code

  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(typeof code === 'string' ? { code } : {}),
  }
}
