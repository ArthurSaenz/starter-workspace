import path from 'node:path'
import process from 'node:process'

import { consoleJsonLogger } from '../ports.js'
import type { ChatLogger, ChatLoggerFactory, UsageModelTotal, UsageStore } from '../ports.js'
import { OPUS_INPUT_USD_PER_MTOK, opusEquivalentTokens } from './pricing.js'

const filename = path.basename(import.meta.url)

const usageLogger = (createLogger: ChatLoggerFactory = consoleJsonLogger): ChatLogger => {
  return createLogger(filename)
}

const DEFAULT_DAILY_RUN_LIMIT = 200

/**
 * The day's ceiling in Opus-input-equivalent tokens: 2M × $4 / MTok ≈ $8 a traveller a day at list
 * price. A heavy turn — three Opus calls over a ~30k-token context, ~1k written each, one cache write
 * then two reads — weighs ~60k, so ~33 of them fit; turns that only burn tokens (five calls on the
 * 300k-character history, each writing the 32k output cap, ~1.1M) reach it in two.
 */
export const DAILY_TOKEN_BUDGET = 2_000_000

/** Every traveller's spend together, per UTC day, unless `AI_GLOBAL_DAILY_BUDGET_USD` says otherwise. */
export const DEFAULT_GLOBAL_DAILY_BUDGET_USD = 150

// The global sum is one indexed aggregate, but every run would pay it; a minute of staleness lets at
// most a minute of spend through past the cap.
export const GLOBAL_BUDGET_CACHE_MS = 60_000

/**
 * The day's spend in Opus-input-equivalent tokens, each model's row at its own price. A row's 1-hour
 * writes are a subset of its cache writes; a row from before that column (null) wrote only 5-minute ones.
 */
export const weightedTokens = (day: { byModel: readonly UsageModelTotal[] }): number => {
  return day.byModel.reduce((sum, row) => {
    const cacheWrite1hTokens = row.cacheCreation1hTokens ?? 0

    return (
      sum +
      opusEquivalentTokens(row.model, {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWrite5mTokens: row.cacheCreationTokens - cacheWrite1hTokens,
        cacheWrite1hTokens,
      })
    )
  }, 0)
}

export const dailyRunLimit = (): number => {
  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  const configured = Number.parseInt(process.env['AI_DAILY_RUN_LIMIT'] ?? '', 10)

  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DAILY_RUN_LIMIT
}

export const globalDailyBudgetUsd = (): number => {
  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  const configured = Number.parseFloat(process.env['AI_GLOBAL_DAILY_BUDGET_USD'] ?? '')

  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GLOBAL_DAILY_BUDGET_USD
}

/**
 * `unavailable`: the quota could not be read, twice; the caller refuses rather than bill blind.
 * `service_exhausted`: every traveller's spend today is over the global cap. `unknown_customer`: the
 * session names a traveller who no longer exists (erased while a token was still valid).
 */
export type SpendAdmission = 'admitted' | 'over_quota' | 'unavailable' | 'service_exhausted' | 'unknown_customer'

/** The narrower answer agent tools act on (`./kit`): anything that is not a yes is a no. */
export type DailyAdmission = 'admitted' | 'over_quota' | 'unavailable'

/**
 * The whole gate, retry included, runs before the first byte. A stalled pooled connection (the
 * Supavisor pipelining hang) only throws at the 90 s Lambda timeout, long after API Gateway's 29 s
 * 504, and holds a slot of the account's small concurrency pool all that time; past this deadline the
 * gate answers `unavailable` and drops the pool, so the next request on this container reconnects.
 * The stalled count is not cancelled: if it lands later, the refused run still counts against the
 * day's cap, which is generous enough to absorb it.
 */
export const GATE_DEADLINE_MS = 8000

/**
 * Rejects once `GATE_DEADLINE_MS` passes. Only a caller that runs before the runtime may pass
 * `dropConnections`: the pool is shared, and closing it inside a run would cut that run's own sibling
 * queries.
 */
export const withinGateDeadline = async <T>(
  check: Promise<T>,
  {
    what,
    dropConnections,
    createLogger,
  }: { what: string; dropConnections: (() => void) | undefined; createLogger?: ChatLoggerFactory },
): Promise<T> => {
  const logger = usageLogger(createLogger)
  let timer: NodeJS.Timeout | undefined

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // `metric` is top-level so a log metric filter can count stuck containers.
      logger.error(`AI ${what} deadline passed${dropConnections ? '; dropping the database pool' : ''}`, {
        metric: 'quota_gate_deadline',
        deadlineMs: GATE_DEADLINE_MS,
        what,
      })
      dropConnections?.()
      reject(new Error(`${what} exceeded ${GATE_DEADLINE_MS} ms`))
    }, GATE_DEADLINE_MS)
  })

  try {
    return await Promise.race([check, deadline])
  } finally {
    clearTimeout(timer)
  }
}

// One retry absorbs a dropped connection on a reused Lambda container; a database that fails twice is
// down, and an unmetered chat during an outage is an unbounded bill. Only for statements safe to repeat.
const withOneRetry = async <T>(attempt: () => Promise<T>, logger: ChatLogger): Promise<T> => {
  try {
    return await attempt()
  } catch (error) {
    logger.warn('AI daily quota read failed; retrying once', { error: String(error) })

    return attempt()
  }
}

const overBudget = (day: { byModel: readonly UsageModelTotal[] }, logger: ChatLogger): boolean => {
  const tokens = weightedTokens(day)

  if (tokens >= DAILY_TOKEN_BUDGET) {
    logger.warn('AI daily token budget reached', { weightedTokens: tokens, budget: DAILY_TOKEN_BUDGET })
  }

  return tokens >= DAILY_TOKEN_BUDGET
}

const utcDay = (): string => {
  return new Date().toISOString().slice(0, 10)
}

let globalSpend: { day: string; usd: number; readAt: number } | undefined

/** Test-only seam: the next check reads the global spend afresh. */
export const __resetGlobalBudgetCache = (): void => {
  globalSpend = undefined
}

// Every traveller's estimated USD today, per container at most once a minute.
const isServiceBudgetExhausted = async (usage: UsageStore, logger: ChatLogger, now = Date.now()): Promise<boolean> => {
  const day = utcDay()

  if (globalSpend === undefined || globalSpend.day !== day || now - globalSpend.readAt >= GLOBAL_BUDGET_CACHE_MS) {
    // Fails open, unlike the traveller's own quota (which still fails closed after this): the global
    // cap is a coarse backstop, and an unreadable aggregate must not refuse every traveller at once.
    try {
      const byModel = await usage.globalDay(day)

      globalSpend = { day, usd: (weightedTokens({ byModel }) * OPUS_INPUT_USD_PER_MTOK) / 1_000_000, readAt: now }
    } catch (error) {
      logger.warn('AI global daily spend not read; checking the traveller quota only', { error: String(error) })

      return false
    }
  }

  const budgetUsd = globalDailyBudgetUsd()

  if (globalSpend.usd < budgetUsd) return false

  // `metric` is a top-level key: the CloudWatch metric filter matches `$.metric`.
  logger.error('AI global daily budget exhausted; refusing new model spend', {
    metric: 'global_budget_exhausted',
    spentUsd: Math.round(globalSpend.usd * 100) / 100,
    budgetUsd,
  })

  return true
}

/** What a gate check reads: the usage store, and the pool to drop when the read stalls before the runtime. */
export interface UsageGate {
  usage: UsageStore
  /** Absent inside a run, whose sibling queries share the pool. */
  dropConnections?: () => void
  createLogger?: ChatLoggerFactory
}

/**
 * Counts the run against the traveller's UTC-day quota in `ai_usage` and says whether it fits: under
 * the global cap, under the run cap, and with the day's tokens so far under `DAILY_TOKEN_BUDGET`.
 * Tokens are recorded after each hop, so the run that crosses the budget finishes and the next one is
 * refused. The count is retried once only with a `runId`, which makes it idempotent.
 * Fails CLOSED: the burst throttle bounds a loop per container only, not across them.
 */
export const admitDailyRun = async (
  customerId: string,
  runId: string | undefined,
  { usage, dropConnections, createLogger }: UsageGate,
): Promise<SpendAdmission> => {
  const logger = usageLogger(createLogger)

  try {
    return await withinGateDeadline(countRun(usage, customerId, runId, logger), {
      what: 'quota check',
      dropConnections,
      ...(createLogger === undefined ? {} : { createLogger }),
    })
  } catch (error) {
    logger.error('AI daily run quota check failed; refusing the run', { error: String(error) })

    return 'unavailable'
  }
}

const countRun = async (
  usage: UsageStore,
  customerId: string,
  runId: string | undefined,
  logger: ChatLogger,
): Promise<SpendAdmission> => {
  if (await isServiceBudgetExhausted(usage, logger)) return 'service_exhausted'

  const count = async () => {
    return usage.countRun(customerId, runId)
  }

  const day = runId === undefined ? await count() : await withOneRetry(count, logger)

  if (day === null) return 'unknown_customer'

  const limit = dailyRunLimit()

  if (day.runs > limit) logger.warn('AI daily run quota reached', { runs: day.runs, limit })

  return day.runs <= limit && !overBudget(day, logger) ? 'admitted' : 'over_quota'
}

const checkSpend = async (
  usage: UsageStore,
  customerId: string,
  requireCustomer: boolean,
  logger: ChatLogger,
): Promise<SpendAdmission> => {
  if (await isServiceBudgetExhausted(usage, logger)) return 'service_exhausted'

  const [day, exists] = await withOneRetry(async () => {
    return Promise.all([usage.day(customerId), requireCustomer ? usage.customerExists(customerId) : true])
  }, logger)

  if (!exists) return 'unknown_customer'

  return day === null || !overBudget(day, logger) ? 'admitted' : 'over_quota'
}

/**
 * The budgets alone, without counting a run: for spend that continues a turn already counted (a form
 * answer, a resumed question) or rides beside it (a suggestion, a transcription, a background search).
 * Fails closed like `admitDailyRun`.
 */
export const admitDailySpend = async (
  customerId: string,
  { usage, dropConnections, createLogger, requireCustomer = true }: UsageGate & { requireCustomer?: boolean },
): Promise<SpendAdmission> => {
  const logger = usageLogger(createLogger)

  try {
    return await withinGateDeadline(checkSpend(usage, customerId, requireCustomer, logger), {
      what: 'quota check',
      dropConnections,
      ...(createLogger === undefined ? {} : { createLogger }),
    })
  } catch (error) {
    logger.error('AI daily token budget check failed; refusing', { error: String(error) })

    return 'unavailable'
  }
}

/**
 * `admitDailySpend` for an agent tool, which tells a traveller "not today" for every refusal but an
 * outage. The traveller was checked when the turn was admitted. Called from inside a run, whose other
 * queries share the pool, so a stalled read never drops it.
 */
export const admitDailyBudget = async (
  customerId: string,
  { usage, createLogger }: { usage: UsageStore; createLogger?: ChatLoggerFactory },
): Promise<DailyAdmission> => {
  const admission = await admitDailySpend(customerId, {
    usage,
    requireCustomer: false,
    ...(createLogger === undefined ? {} : { createLogger }),
  })

  if (admission === 'service_exhausted' || admission === 'unknown_customer') return 'over_quota'

  return admission
}
