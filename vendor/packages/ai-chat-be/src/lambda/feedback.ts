import path from 'node:path'
import process from 'node:process'
import { z } from 'zod-v4'

import { scrubTraceText, traceMaskingModeFor } from '../langgraph/traceMasking.js'
import { consoleJsonLogger } from '../ports.js'
import type { ChatHistoryStore, ChatLogger, ChatLoggerFactory, ChatRatingWrite } from '../ports.js'
import { trackBackgroundWrite } from '../tools/backgroundWrites.js'
import { withinGateDeadline } from './usage.js'

const filename = path.basename(import.meta.url)

// The ids are AG-UI ids the browser holds (UUIDs in practice); bounded so a row stays small.
const ID = z.string().trim().min(1).max(128)

const feedbackSchema = z.object({
  threadId: ID,
  messageId: ID,
  rating: z.enum(['up', 'down']),
  reason: z.string().trim().max(500).optional(),
})

export type FeedbackOutcome = 'stored' | 'invalid'

/** The LangSmith feedback key a vote is filed under, beside the trace it rates. */
export const LANGSMITH_FEEDBACK_KEY = 'user_rating'

// The langsmith `Client` method, typed here: `LangChainTracer.client` is declared by a narrower
// tracing interface, and the package is not a direct dependency.
interface FeedbackClient {
  createFeedback: (runId: string, key: string, options: { score: number; comment?: string }) => Promise<unknown>
}

/**
 * Files the vote on the trace of the turn that wrote the answer (`customer_chats.trace_run_ids`), so
 * a thumbs-down can be read beside the run it judges. Never fails the vote: a chat kept before trace
 * ids existed, or a message of a chat never kept, has no trace to attach to.
 */
const sendToLangSmith = async (vote: ChatRatingWrite, history: ChatHistoryStore, logger: ChatLogger): Promise<void> => {
  try {
    const chat = await history.getChat(vote.customerId, vote.threadId)
    const runId = chat?.traceRunIds?.[vote.messageId]

    if (runId === undefined) {
      logger.info('AI chat feedback not sent to LangSmith: no trace for the message', { threadId: vote.threadId })

      return
    }

    const { LangChainTracer } = await import('@langchain/core/tracers/tracer_langchain')
    const client = new LangChainTracer().client as unknown as FeedbackClient

    // The reason is the traveller's own words, masked like every other piece of trace text.
    // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
    const mode = traceMaskingModeFor(process.env['LANGSMITH_PROJECT'])

    await client.createFeedback(runId, LANGSMITH_FEEDBACK_KEY, {
      score: vote.rating === 'up' ? 1 : 0,
      ...(vote.reason === null ? {} : { comment: scrubTraceText(vote.reason, mode) }),
    })
  } catch (error) {
    logger.warn('AI chat feedback not sent to LangSmith', { error: String(error) })
  }
}

/**
 * Stores a traveller's rating of one assistant message. The owner is the verified session's
 * customer, never a body field, so nobody can vote in another traveller's name. With tracing on, the
 * vote also reaches LangSmith, after the response (the handler settles it before the invocation ends).
 */
export const storeFeedback = async (
  customerId: string,
  rawBody: string | null,
  {
    history,
    dropConnections,
    createLogger = consoleJsonLogger,
  }: { history: ChatHistoryStore; dropConnections: () => void; createLogger?: ChatLoggerFactory },
): Promise<FeedbackOutcome> => {
  const logger = createLogger(filename)
  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody ?? '')
  } catch {
    return 'invalid'
  }

  const result = feedbackSchema.safeParse(parsed)

  if (!result.success) return 'invalid'

  const { threadId, messageId, rating, reason } = result.data
  const vote: ChatRatingWrite = { customerId, threadId, messageId, rating, reason: reason || null }

  // Answered before the first byte, like the quota gate: a stalled pooled connection must fail the
  // vote, not hold the invocation past API Gateway's timeout.
  await withinGateDeadline(history.saveRating(vote), { what: 'feedback write', dropConnections, createLogger })

  logger.info('AI chat feedback stored', { threadId, messageId, rating, hasReason: Boolean(reason) })

  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  if (process.env['LANGSMITH_TRACING'] === 'true') trackBackgroundWrite(sendToLangSmith(vote, history, logger))

  return 'stored'
}
