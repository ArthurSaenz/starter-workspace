import type { Message } from '@ag-ui/client'
import { createHash } from 'node:crypto'

import { MAX_HISTORY_SUMMARY_CHARS, droppedThroughTurnOf, messagesThroughTurn } from './messageConversion.js'
import type { HistorySummary } from './messageConversion.js'
import { isProgramSummaryMarker } from './programSummaryMarker.js'

export interface HistorySummaryRequest {
  /** The summary of the turns before `transcript`, to fold in; absent when summarising from turn 1. */
  previousSummary?: string
  /** The dropped turns as plain `Traveller:` / `Assistant:` lines (the app's name for a summary marker). */
  transcript: string
  /** The traveller the call is billed to. */
  customerId: string
  /** The chat's scoped thread (`<owner>:<chatId>`), so the call's trace joins the chat's in LangSmith. */
  threadId: string
  signal: AbortSignal
}

/** Writes the summary; supplied by the agent package, which owns the model clients. */
export type HistorySummarizer = (request: HistorySummaryRequest) => Promise<string>

// One message rarely needs more to carry its facts; a pasted page would otherwise fill the budget.
const MAX_SUMMARY_MESSAGE_CHARS = 2_000

// Bounds one summariser call: the dropped part of a chat can hold up to `MAX_HISTORY_CHARS`.
export const MAX_SUMMARY_TRANSCRIPT_CHARS = 60_000
// The summary is made before the run starts, so it delays the answer; past this the turns are just dropped.
export const HISTORY_SUMMARY_TIMEOUT_MS = 10_000

const textOf = (message: Message): string => {
  const { content } = message

  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block: { type?: unknown; text?: unknown }) => {
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .join('')
}

// A summary marker is the server's own line, so the summary never credits it to the traveller.
const speakerOf = (message: Message, appName: string): string => {
  if (message.role === 'assistant') return 'Assistant'

  return isProgramSummaryMarker(message) ? appName : 'Traveller'
}

/**
 * The traveller's and the assistant's own words only. Tool results and tool-call arguments stay out:
 * web pages and search payloads are not the conversation, and a summary the model reads on every
 * later turn must not become a way for fetched text to outlive the turn that fetched it. Newest
 * lines are kept when the budget runs out — the previous summary already covers what came before.
 */
export const summaryTranscriptOf = (messages: readonly Message[], appName: string): string => {
  const lines = messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []

    const text = textOf(message).trim()

    if (text.length === 0) return []

    const speaker = speakerOf(message, appName)

    return [`${speaker}: ${text.slice(0, MAX_SUMMARY_MESSAGE_CHARS)}`]
  })

  const kept: string[] = []
  let chars = 0

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string

    if (chars + line.length > MAX_SUMMARY_TRANSCRIPT_CHARS) break

    kept.push(line)
    chars += line.length + 1
  }

  return kept.reverse().join('\n')
}

/**
 * Identifies the messages a summary was made from, so one made before an edit or regenerate rewrote
 * those turns is not reused for the new ones that happen to end at the same turn.
 */
export const historyFingerprintOf = (messages: readonly Message[]): string => {
  const ids = messages.map((message) => {
    return message.id
  })

  return createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 32)
}

export interface KeptHistorySummary extends HistorySummary {
  fingerprint: string
}

export interface ResolvedHistorySummary {
  summary: HistorySummary
  /** Of the messages through `summary.throughTurn`; kept with the summary. */
  fingerprint: string
  /** Written by this call (to be kept on the chat), not read back from it. */
  isFresh: boolean
}

/**
 * The summary of the turns this history's model input drops, or `undefined` when it drops none (or
 * nothing in them has words to summarise). The kept one is reused while the cut stays where it was,
 * so the summary — and with it the prompt cache's prefix — changes only when the cut moves a block. A
 * cut that moved forward folds the newly dropped turns into the kept summary instead of re-reading the
 * whole dropped part. A kept summary whose messages were since rewritten is ignored.
 *
 * Without `summarize` only a kept summary is used: the caller is backing off a summariser that failed.
 * Throws when the summariser does or replies with nothing; the caller fails open (the turns are
 * dropped unsummarised).
 */
export const resolveHistorySummary = async ({
  messages,
  frontendToolNames,
  kept,
  summarize,
  customerId,
  threadId,
  appName,
}: {
  messages: readonly Message[]
  frontendToolNames: ReadonlySet<string>
  kept: KeptHistorySummary | null
  summarize: HistorySummarizer | undefined
  customerId: string
  threadId: string
  /** The speaker of a summary marker's line. */
  appName: string
}): Promise<ResolvedHistorySummary | undefined> => {
  const throughTurn = droppedThroughTurnOf(messages, frontendToolNames)

  if (throughTurn === 0) return undefined

  const dropped = messagesThroughTurn(messages, throughTurn)
  const fingerprint = historyFingerprintOf(dropped)
  const keptDropped = kept === null ? [] : messagesThroughTurn(messages, kept.throughTurn)

  const isKeptUsable =
    kept !== null &&
    kept.text.length > 0 &&
    kept.throughTurn <= throughTurn &&
    kept.fingerprint === historyFingerprintOf(keptDropped)

  if (isKeptUsable && kept.throughTurn === throughTurn) {
    return { summary: { text: kept.text, throughTurn }, fingerprint, isFresh: false }
  }

  const newlyDropped = isKeptUsable ? dropped.slice(keptDropped.length) : dropped
  const transcript = summaryTranscriptOf(newlyDropped, appName)

  if (transcript.length === 0) {
    // Nothing new to read: the kept summary still covers every word dropped so far.
    return isKeptUsable ? { summary: { text: kept.text, throughTurn }, fingerprint, isFresh: false } : undefined
  }

  if (summarize === undefined) return undefined

  const text = (
    await summarize({
      ...(isKeptUsable ? { previousSummary: kept.text } : {}),
      transcript,
      customerId,
      threadId,
      signal: AbortSignal.timeout(HISTORY_SUMMARY_TIMEOUT_MS),
    })
  )
    .trim()
    .slice(0, MAX_HISTORY_SUMMARY_CHARS)

  if (text.length === 0) throw new Error('the summariser replied with no summary')

  return { summary: { text, throughTurn }, fingerprint, isFresh: true }
}

// The runner resolves the summary; the agent builds the model input. They share the agent instance the
// runtime made for the request, so the summary never travels on the wire, where a caller could write it.
const attached = new WeakMap<object, HistorySummary>()

export const attachHistorySummary = (agent: object, summary: HistorySummary | undefined): void => {
  if (summary === undefined) attached.delete(agent)
  else attached.set(agent, summary)
}

export const attachedHistorySummary = (agent: object): HistorySummary | undefined => {
  return attached.get(agent)
}
