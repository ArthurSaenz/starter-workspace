import process from 'node:process'

export type LogFields = Record<string, unknown>

/** The log surface the engine writes to; the host supplies it (a Powertools `Logger` fits as is). */
export interface ChatLogger {
  debug: (message: string, ...fields: LogFields[]) => void
  info: (message: string, ...fields: LogFields[]) => void
  warn: (message: string, ...fields: LogFields[]) => void
  error: (message: string, ...fields: LogFields[]) => void
  /** Keys every later line of this logger carries, until `resetKeys`. */
  appendKeys: (keys: LogFields) => void
  resetKeys: () => void
}

/**
 * Keyed by the engine module's own service name, so the engine names its lines and a host only
 * decides where they go.
 */
export type ChatLoggerFactory = (serviceName: string) => ChatLogger

const serialise = (head: { level: string; message: string; service: string }, rest: LogFields): string => {
  try {
    return JSON.stringify({ ...head, ...rest })
  } catch {
    // A circular field must not turn a log call into a thrown error inside the run.
    return JSON.stringify(head)
  }
}

/**
 * The default when a host passes no factory: one JSON line per call with the fields at the top level
 * (a metric filter reads `$.metric`), INFO and DEBUG on stdout, WARN and ERROR on stderr. Meant for
 * tests and local runs; a deployed host passes its own.
 */
export const consoleJsonLogger: ChatLoggerFactory = (serviceName) => {
  let keys: LogFields = {}

  const write = (level: string, stream: NodeJS.WriteStream) => {
    return (message: string, ...fields: LogFields[]): void => {
      const head = { level, message, service: serviceName }

      stream.write(`${serialise(head, Object.assign({ timestamp: new Date().toISOString(), ...keys }, ...fields))}\n`)
    }
  }

  return {
    debug: write('DEBUG', process.stdout),
    info: write('INFO', process.stdout),
    warn: write('WARN', process.stderr),
    error: write('ERROR', process.stderr),
    appendKeys: (more) => {
      keys = { ...keys, ...more }
    },
    resetKeys: () => {
      keys = {}
    },
  }
}

/** A traveller's kept conversation, as the store hands it back. */
export interface KeptChat {
  id: string
  title: string
  /** The AG-UI transcript, opaque to the store. */
  messages: unknown[]
  /** The agent's shared state; null when the run left none. */
  state: Record<string, unknown> | null
  /** The interrupts the last run paused on; null when it finished without a question. */
  interrupts: unknown[] | null
  /** Assistant message id → the trace of the turn that wrote it. */
  traceRunIds: Record<string, string> | null
  historySummary: string | null
  historySummaryThroughTurn: number | null
  historySummaryFingerprint: string | null
  createdAt: string
  /** The save guard: a write that names it is refused once another writer has moved it. */
  updatedAt: string
}

export type KeptChatListing = Pick<KeptChat, 'id' | 'title' | 'createdAt' | 'updatedAt'>

export interface KeptChatWrite {
  id: string
  customerId: string
  title: string
  messages: unknown[]
  state: Record<string, unknown> | null
  interrupts: unknown[] | null
  traceRunIds: Record<string, string>
}

export type ChatRating = 'up' | 'down'

export interface ChatRatingWrite {
  customerId: string
  threadId: string
  messageId: string
  rating: ChatRating
  reason: string | null
}

/**
 * A traveller's kept chats and their thumbs. Every method takes the owner: a chat id is minted by the
 * browser, so another traveller's chat must read as absent.
 */
export interface ChatHistoryStore {
  getChat: (customerId: string, threadId: string) => Promise<KeptChat | null>
  /** Newest first, without transcripts. */
  listChats: (customerId: string, limit: number) => Promise<KeptChatListing[]>
  countChats: (customerId: string) => Promise<number>
  /**
   * Inserts or replaces the chat in one step. `false`: the id is another traveller's, or `expectedUpdatedAt`
   * no longer matches the kept row.
   */
  saveChat: (chat: KeptChatWrite, guard?: { expectedUpdatedAt: string }) => Promise<boolean>
  /** Leaves `updatedAt` alone: the run that asked for it still saves under its guard. */
  setHistorySummary: (
    customerId: string,
    threadId: string,
    summary: { text: string; throughTurn: number; fingerprint: string },
  ) => Promise<void>
  listRatings: (customerId: string, threadId: string) => Promise<{ messageId: string; rating: ChatRating }[]>
  /** A second vote on the same message replaces the first, reason included. */
  saveRating: (vote: ChatRatingWrite) => Promise<void>
}

export interface ThreadRunKey {
  customerId: string
  threadId: string
  runId: string
}

export type ThreadRunBeat = 'running' | 'stop_requested' | 'superseded'

/**
 * A thread run that has not beaten for this long was left by a container that died mid-run. Any other
 * reader of the host's run leases must use the same figure, so all agree on when a run is live.
 */
export const THREAD_RUN_STALE_SEC = 30

/** The leases that keep one run per chat thread, and one summary turn per background run, across containers. */
export interface RunLeaseStore {
  /**
   * Takes the thread for the run; `false` while another run still beats. A run that has not beaten for
   * `staleAfterSec` is taken over, and one asked to stop keeps the thread `stopGraceSec` longer.
   */
  claimThread: (key: ThreadRunKey, staleAfterSec: number, stopGraceSec: number) => Promise<boolean>
  beatThread: (key: ThreadRunKey) => Promise<ThreadRunBeat>
  /** Frees the thread, unless another run already took it over. */
  releaseThread: (key: ThreadRunKey) => Promise<void>
  /** Asks the thread's run (only `runId`, when given) to stop; `true` when one was there to ask. */
  requestStop: (customerId: string, threadId: string, runId?: string) => Promise<boolean>
  /**
   * Claims the summary turn of the traveller's finished background run in this thread. The claim's
   * timestamp, or `null`: not theirs, not settled, already summed up, or claimed by a live turn.
   */
  claimSummary: (programRunId: string, customerId: string, threadId: string) => Promise<string | null>
  /** `false` when the claim moved on. */
  completeSummary: (programRunId: string, claimedAt: string) => Promise<boolean>
  releaseSummary: (programRunId: string, claimedAt: string) => Promise<void>
}

/** One model's tokens over a day. */
export interface UsageModelTotal {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Every cache write, whatever its TTL. */
  cacheCreationTokens: number
  /** The 1-hour part of `cacheCreationTokens`; null on rows written before it was counted. */
  cacheCreation1hTokens: number | null
}

export interface UsageDay {
  runs: number
  byModel: readonly UsageModelTotal[]
}

/** A traveller's UTC-day spend, which the daily quota and budgets are checked on. */
export interface UsageStore {
  /** Every traveller's tokens of the UTC day `day` (`YYYY-MM-DD`). */
  globalDay: (day: string) => Promise<readonly UsageModelTotal[]>
  /**
   * Counts one run on today's row and returns the day; a `runId` seen moments ago is not counted again.
   * `null`: the traveller does not exist.
   */
  countRun: (customerId: string, runId?: string) => Promise<UsageDay | null>
  /** Today's spend; `null` when nothing is recorded yet. */
  day: (customerId: string) => Promise<UsageDay | null>
  customerExists: (customerId: string) => Promise<boolean>
}

export interface RunFailureToolCall {
  name: string
  /** `success` / `error` from the tool's message; `unfinished` when the run failed while it ran. */
  status: string
  durationMs: number
}

/** A run that ended with RUN_ERROR, kept whatever the trace sampling dropped. */
export interface RunFailure {
  /** The run's trace id (`traceRunIdOf`): a second failure of the same run replaces the first. */
  traceRunId: string
  customerId: string | null
  threadId: string
  runId: string
  promptVersion: string | null
  model: string | null
  errorCode: string | null
  /** Redacted (`toSafeErrorMessage`). */
  errorMessage: string
  toolCalls: RunFailureToolCall[]
}

export interface RunFailureSink {
  /** `keepExisting`: a writer that knows less about the failure leaves an earlier record as it is. */
  record: (failure: RunFailure, options?: { keepExisting?: boolean }) => Promise<void>
}

/** Every store the Lambda pair reads and writes, supplied by the host. */
export interface ChatStorage {
  history: ChatHistoryStore
  usage: UsageStore
  runLeases: RunLeaseStore
  runFailures: RunFailureSink
  /**
   * Drops the stores' connections after a gate read stalled past its deadline, so the next request on
   * this container reconnects. Only called before the runtime starts, when no run shares them.
   */
  dropConnections: () => void
}
