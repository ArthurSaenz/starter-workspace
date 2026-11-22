// In-memory stand-ins for the storage ports, with the semantics of the host's Postgres adapters
// (apps/ai/api/src/lib/chat-adapters, whose own suites run the same rules on PGlite): owner-scoped chats with
// a guarded save, thread leases that go stale, summary claims, a daily usage row per model with the
// run-id retry window, failures keyed by trace id. Each method is a `vi.fn`-free plain function, so a
// suite spies on the one it needs (`vi.spyOn(storage.history, 'getChat')`).
import type {
  ChatHistoryStore,
  ChatRating,
  ChatStorage,
  KeptChat,
  RunFailure,
  RunFailureSink,
  RunLeaseStore,
  ThreadRunBeat,
  UsageDay,
  UsageModelTotal,
  UsageStore,
} from '../../ports.js'

interface StoredChat extends KeptChat {
  customerId: string
  customTitle: string | null
}

interface StoredRating {
  customerId: string
  threadId: string
  messageId: string
  rating: ChatRating
  reason: string | null
}

interface ThreadRun {
  customerId: string
  threadId: string
  runId: string
  heartbeatAt: number
  stopRequestedAt: number | null
}

/** The columns of `agent_program_runs` a summary claim reads. */
export interface ProgramRunRow {
  id: string
  customerId: string | null
  threadId: string | null
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  cancelRequestedAt: number | null
  summaryAskedAt: number | null
  summaryRunStartedAt: string | null
  summaryCompletedAt: string | null
}

interface UsageRow extends UsageModelTotal {
  runs: number
  runIds: { id: string; at: number }[]
}

// lib-db `UNKNOWN_AI_MODEL`, `RUN_RETRY_WINDOW_SEC`, `SUMMARY_LEASE_MS`: the figures the Postgres adapter runs on.
const RUNS_MODEL = 'unknown'
const RUN_RETRY_WINDOW_MS = 60_000
const RECENT_RUN_IDS = 20
const SUMMARY_LEASE_MS = 150_000

export interface StoredFailure extends RunFailure {
  createdAt: number
}

export class MemoryStorage implements ChatStorage {
  readonly chats = new Map<string, StoredChat>()
  readonly ratings = new Map<string, StoredRating>()
  readonly threadRuns = new Map<string, ThreadRun>()
  readonly programRuns = new Map<string, ProgramRunRow>()
  readonly failures = new Map<string, StoredFailure>()
  readonly customers = new Set<string>()
  // `<customerId>|<day>|<model>`
  readonly usageRows = new Map<string, UsageRow & { customerId: string; day: string }>()
  dropCount = 0

  private lastStamp = 0

  // Distinct, increasing timestamps: two saves in one millisecond must still move `updatedAt`.
  private stamp(): string {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1)

    return new Date(this.lastStamp).toISOString()
  }

  /** What another writer does to every kept chat's `updatedAt` (moves it into the past). */
  backdateChats(ms: number): void {
    for (const chat of this.chats.values()) {
      chat.updatedAt = new Date(Date.parse(chat.updatedAt) - ms).toISOString()
    }
  }

  readonly history: ChatHistoryStore = {
    getChat: async (customerId, threadId) => {
      const chat = this.chats.get(threadId)

      return chat === undefined || chat.customerId !== customerId ? null : structuredClone(chat)
    },
    listChats: async (customerId, limit) => {
      return [...this.chats.values()]
        .filter((chat) => {
          return chat.customerId === customerId
        })
        .sort((a, b) => {
          return b.updatedAt.localeCompare(a.updatedAt)
        })
        .slice(0, limit)
        .map(({ id, title, customTitle, createdAt, updatedAt }) => {
          return { id, title: customTitle ?? title, createdAt, updatedAt }
        })
    },
    countChats: async (customerId) => {
      return [...this.chats.values()].filter((chat) => {
        return chat.customerId === customerId
      }).length
    },
    saveChat: async (write, guard) => {
      const existing = this.chats.get(write.id)
      const now = this.stamp()

      if (existing !== undefined) {
        if (existing.customerId !== write.customerId) return false
        if (guard !== undefined && existing.updatedAt !== guard.expectedUpdatedAt) return false

        this.chats.set(write.id, {
          ...existing,
          title: write.title,
          messages: structuredClone(write.messages),
          state: structuredClone(write.state),
          interrupts: structuredClone(write.interrupts),
          traceRunIds: { ...write.traceRunIds },
          updatedAt: now,
        })

        return true
      }

      this.chats.set(write.id, {
        id: write.id,
        customerId: write.customerId,
        title: write.title,
        customTitle: null,
        messages: structuredClone(write.messages),
        state: structuredClone(write.state),
        interrupts: structuredClone(write.interrupts),
        traceRunIds: { ...write.traceRunIds },
        historySummary: null,
        historySummaryThroughTurn: null,
        historySummaryFingerprint: null,
        createdAt: now,
        updatedAt: now,
      })

      return true
    },
    setHistorySummary: async (customerId, threadId, { text, throughTurn, fingerprint }) => {
      const chat = this.chats.get(threadId)

      if (chat === undefined || chat.customerId !== customerId) return

      chat.historySummary = text
      chat.historySummaryThroughTurn = throughTurn
      chat.historySummaryFingerprint = fingerprint
    },
    listRatings: async (customerId, threadId) => {
      return [...this.ratings.values()]
        .filter((vote) => {
          return vote.customerId === customerId && vote.threadId === threadId
        })
        .map(({ messageId, rating }) => {
          return { messageId, rating }
        })
    },
    saveRating: async (vote) => {
      this.ratings.set(`${vote.customerId}:${vote.messageId}`, { ...vote })
    },
  }

  /**
   * A save by another writer (another tab, client-api), the way lib-db `upsertForUser` does it: a field
   * left out keeps the kept one, and another traveller's id is left alone.
   */
  keepChat(chat: {
    id: string
    customerId: string
    title: string
    messages: unknown[]
    state?: Record<string, unknown> | null
    interrupts?: unknown[] | null
    traceRunIds?: Record<string, string> | null
  }): void {
    const existing = this.chats.get(chat.id)
    const now = this.stamp()

    if (existing !== undefined && existing.customerId !== chat.customerId) return

    const base: StoredChat = existing ?? {
      id: chat.id,
      customerId: chat.customerId,
      title: chat.title,
      customTitle: null,
      messages: [],
      state: null,
      interrupts: null,
      traceRunIds: null,
      historySummary: null,
      historySummaryThroughTurn: null,
      historySummaryFingerprint: null,
      createdAt: now,
      updatedAt: now,
    }

    this.chats.set(chat.id, {
      ...base,
      title: chat.title,
      messages: structuredClone(chat.messages),
      ...(chat.state === undefined ? {} : { state: structuredClone(chat.state) }),
      ...(chat.interrupts === undefined ? {} : { interrupts: structuredClone(chat.interrupts) }),
      ...(chat.traceRunIds === undefined ? {} : { traceRunIds: chat.traceRunIds }),
      updatedAt: now,
    })
  }

  readonly runLeases: RunLeaseStore = {
    claimThread: async (key, staleAfterSec, stopGraceSec) => {
      const slot = `${key.customerId}:${key.threadId}`
      const row = this.threadRuns.get(slot)
      const now = Date.now()

      const isFree =
        row === undefined ||
        row.heartbeatAt < now - staleAfterSec * 1000 ||
        (row.stopRequestedAt !== null && row.stopRequestedAt < now - stopGraceSec * 1000)

      if (!isFree) return false

      this.threadRuns.set(slot, { ...key, heartbeatAt: now, stopRequestedAt: null })

      return true
    },
    beatThread: async (key): Promise<ThreadRunBeat> => {
      const row = this.threadRuns.get(`${key.customerId}:${key.threadId}`)

      if (row?.runId !== key.runId) return 'superseded'

      row.heartbeatAt = Date.now()

      return row.stopRequestedAt === null ? 'running' : 'stop_requested'
    },
    releaseThread: async (key) => {
      const slot = `${key.customerId}:${key.threadId}`

      if (this.threadRuns.get(slot)?.runId === key.runId) this.threadRuns.delete(slot)
    },
    requestStop: async (customerId, threadId, runId) => {
      const row = this.threadRuns.get(`${customerId}:${threadId}`)

      if (row === undefined || (runId !== undefined && row.runId !== runId) || row.stopRequestedAt !== null) {
        return false
      }

      row.stopRequestedAt = Date.now()

      return true
    },
    claimSummary: async (programRunId, customerId, threadId) => {
      const run = this.programRuns.get(programRunId)
      const now = Date.now()

      if (
        run === undefined ||
        run.customerId !== customerId ||
        run.threadId !== threadId ||
        (run.status !== 'done' && run.status !== 'failed') ||
        run.cancelRequestedAt !== null ||
        run.summaryCompletedAt !== null
      ) {
        return null
      }

      const startedAt = run.summaryRunStartedAt === null ? null : Date.parse(run.summaryRunStartedAt)

      if (startedAt !== null && startedAt >= now - SUMMARY_LEASE_MS) return null
      if (run.summaryAskedAt !== null && (startedAt === null || run.summaryAskedAt < startedAt)) return null

      run.summaryRunStartedAt = this.stamp()

      return run.summaryRunStartedAt
    },
    completeSummary: async (programRunId, claimedAt) => {
      const run = this.programRuns.get(programRunId)

      if (run?.summaryRunStartedAt !== claimedAt) return false

      run.summaryCompletedAt = this.stamp()

      return true
    },
    releaseSummary: async (programRunId, claimedAt) => {
      const run = this.programRuns.get(programRunId)

      if (run?.summaryRunStartedAt !== claimedAt || run.summaryCompletedAt !== null) return

      run.summaryRunStartedAt = null
      run.summaryAskedAt = null
    },
  }

  /** A background run in the state a test needs; settled (`done`) by default. */
  seedProgramRun(run: Partial<ProgramRunRow> & Pick<ProgramRunRow, 'id'>): ProgramRunRow {
    const row: ProgramRunRow = {
      customerId: null,
      threadId: null,
      status: 'done',
      cancelRequestedAt: null,
      summaryAskedAt: null,
      summaryRunStartedAt: null,
      summaryCompletedAt: null,
      ...run,
    }

    this.programRuns.set(row.id, row)

    return row
  }

  readonly runFailures: RunFailureSink = {
    record: async (failure, options) => {
      if (options?.keepExisting === true && this.failures.has(failure.traceRunId)) return

      this.failures.set(failure.traceRunId, { ...structuredClone(failure), createdAt: Date.now() })
    },
  }

  private static utcDay(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private rowsOf(customerId: string, day: string): (UsageRow & { customerId: string; day: string })[] {
    return [...this.usageRows.values()]
      .filter((row) => {
        return row.customerId === customerId && row.day === day
      })
      .sort((a, b) => {
        return a.model.localeCompare(b.model)
      })
  }

  private dayOf(customerId: string, day: string): UsageDay | null {
    const rows = this.rowsOf(customerId, day)

    if (rows.length === 0) return null

    return {
      runs: rows.reduce((sum, row) => {
        return sum + row.runs
      }, 0),
      byModel: rows.map(
        ({ model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, cacheCreation1hTokens }) => {
          return { model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, cacheCreation1hTokens }
        },
      ),
    }
  }

  private usageRow(customerId: string, day: string, model: string): UsageRow & { customerId: string; day: string } {
    const key = `${customerId}|${day}|${model}`
    const existing = this.usageRows.get(key)

    if (existing !== undefined) return existing

    const row = {
      customerId,
      day,
      model,
      runs: 0,
      runIds: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation1hTokens: null,
    }

    this.usageRows.set(key, row)

    return row
  }

  /** lib-db `RepoAiUsage.addTokens`: what the agent records after each model call. */
  addTokens(write: {
    customerId: string
    model: string
    inputTokens: number
    outputTokens: number
    cache?: { read: number; write: number; write1h?: number }
  }): void {
    const row = this.usageRow(write.customerId, MemoryStorage.utcDay(), write.model)
    const cache = write.cache ?? { read: 0, write: 0 }

    row.inputTokens += write.inputTokens
    row.outputTokens += write.outputTokens
    row.cacheReadTokens += cache.read
    row.cacheCreationTokens += cache.write
    if (cache.write1h !== undefined) row.cacheCreation1hTokens = (row.cacheCreation1hTokens ?? 0) + cache.write1h
  }

  /** Today's runs and tokens of one traveller, as `ai_usage` holds them. */
  usageDay(customerId: string): UsageDay | null {
    return this.dayOf(customerId, MemoryStorage.utcDay())
  }

  readonly usage: UsageStore = {
    globalDay: async (day) => {
      const totals = new Map<string, UsageModelTotal>()

      for (const row of this.usageRows.values()) {
        if (row.day !== day) continue

        const total = totals.get(row.model) ?? {
          model: row.model,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheCreation1hTokens: 0,
        }

        total.inputTokens += row.inputTokens
        total.outputTokens += row.outputTokens
        total.cacheReadTokens += row.cacheReadTokens
        total.cacheCreationTokens += row.cacheCreationTokens
        total.cacheCreation1hTokens = (total.cacheCreation1hTokens ?? 0) + (row.cacheCreation1hTokens ?? 0)
        totals.set(row.model, total)
      }

      return [...totals.values()]
    },
    countRun: async (customerId, runId) => {
      if (!this.customers.has(customerId)) return null

      const day = MemoryStorage.utcDay()
      const row = this.usageRow(customerId, day, RUNS_MODEL)
      const now = Date.now()

      const isRetried =
        runId !== undefined &&
        row.runIds.some((entry) => {
          return entry.id === runId && entry.at >= now - RUN_RETRY_WINDOW_MS
        })

      if (!isRetried) {
        row.runs += 1
        if (runId !== undefined) row.runIds = [{ id: runId, at: now }, ...row.runIds].slice(0, RECENT_RUN_IDS)
      }

      return this.dayOf(customerId, day)
    },
    day: async (customerId) => {
      return this.dayOf(customerId, MemoryStorage.utcDay())
    },
    customerExists: async (customerId) => {
      return this.customers.has(customerId)
    },
  }

  dropConnections(): void {
    this.dropCount += 1
  }
}
