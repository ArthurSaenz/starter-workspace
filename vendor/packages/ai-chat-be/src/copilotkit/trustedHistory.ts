import type { Message } from '@ag-ui/client'

import {
  A2UI_CANCELLED_RESULT,
  A2UI_OPERATIONS_KEY,
  A2UI_RENDERED_RESULT,
  A2UI_SURFACE_ACTIVITY,
  a2uiSurfaceActivityId,
} from './a2ui.js'
import { isProgramSummaryMarker } from './programSummaryMarker.js'

/** What the server itself wrote for a thread: the `customer_chats` row, or `null` for a new thread. */
export interface KeptHistory {
  messages: readonly unknown[]
  interrupts: readonly unknown[] | null
}

export interface TrustedHistory {
  messages: Message[]
  /** Browser messages refused, counted by role. Never their content: it is the traveller's conversation. */
  dropped: Record<string, number>
  /** The kept transcript was cut after its last user turn to answer that turn again (`regenerateFrom`). */
  regenerated: boolean
  /** The run answers a question: the browser added a user turn, or a kept one is answered again. */
  newTurn: boolean
}

export interface TrustedHistoryOptions {
  /** The id of the user turn the browser asks to answer again (regenerate, or retry of a kept turn). */
  regenerateFrom?: string
  /** The tools the A2UI middleware answers itself (`a2uiRenderToolNames`); absent while A2UI is off. */
  renderToolNames?: ReadonlySet<string>
}

const NO_TOOLS: ReadonlySet<string> = new Set()

// A summary marker is the server's turn, not a question: regenerate and Edit target the traveller's
// last real question, and cutting there drops the launch reply, the marker and the summary with it.
const lastUserIndex = (messages: readonly Message[]): number => {
  return messages
    .map((message) => {
      return message.role === 'user' && !isProgramSummaryMarker(message)
    })
    .lastIndexOf(true)
}

// The calls a browser may still answer: those of the kept transcript's last assistant turn with no
// result after them. Any call followed by something else is abandoned (`answerAbandonedToolCalls`),
// and every server tool returns inside its own run, so a trailing call is a frontend tool waiting
// on the browser. Activity messages never reach the model, so they do not end the tail. A render
// call is the exception: the A2UI middleware answers it and the browser only draws, so the browser
// is never waited on for one.
export const awaitingBrowserResults = (
  kept: readonly Message[],
  renderToolNames: ReadonlySet<string> = NO_TOOLS,
): Set<string> => {
  const answered = new Set<string>()

  for (let index = kept.length - 1; index >= 0; index -= 1) {
    const message = kept[index]

    if (message === undefined || message.role === 'activity') continue

    if (message.role === 'tool') {
      answered.add(message.toolCallId)
      continue
    }

    if (message.role !== 'assistant') return new Set()

    return new Set(
      (message.toolCalls ?? [])
        .filter((toolCall) => {
          return !answered.has(toolCall.id) && !renderToolNames.has(toolCall.function.name)
        })
        .map((toolCall) => {
          return toolCall.id
        }),
    )
  }

  return new Set()
}

export const renderResultId = (toolCallId: string): string => {
  return `a2ui-result-${toolCallId}`
}

const isPaintedSurface = (message: Message): boolean => {
  if (message.role !== 'activity' || message.activityType !== A2UI_SURFACE_ACTIVITY) return false

  const operations = (message.content as Record<string, unknown> | null)?.[A2UI_OPERATIONS_KEY]

  return Array.isArray(operations) && operations.length > 0
}

/**
 * The kept transcript with every render call that was never answered given its result, directly
 * after the turn that made it. A run stopped or paused after drawing leaves such a call, and
 * `@ag-ui/a2ui-middleware` 0.0.16 (`recoverUnansweredCalls`) answers any it finds by replacing the
 * surface's activity with a failure — the comparison the traveller already saw would be gone for
 * good. The result says what the traveller saw: `rendered` when a surface was painted for the
 * call, `cancelled` when the run was cut before one was.
 */
export const answerRenderCalls = (kept: readonly Message[], renderToolNames: ReadonlySet<string>): Message[] => {
  if (renderToolNames.size === 0) return [...kept]

  const answered = new Set<string>()
  const painted = new Set<string>()

  for (const message of kept) {
    if (message.role === 'tool') answered.add(message.toolCallId)
    if (isPaintedSurface(message)) painted.add(message.id)
  }

  let owed: Message[] = []

  const answeredKept = kept.flatMap((message): Message[] => {
    // The provider wants a call's results directly after the calling turn, so they go in before
    // whatever else followed it.
    const due = message.role === 'tool' ? [] : owed

    if (message.role !== 'tool') owed = []

    if (message.role === 'assistant') {
      owed = (message.toolCalls ?? [])
        .filter((toolCall) => {
          return renderToolNames.has(toolCall.function.name) && !answered.has(toolCall.id)
        })
        .map((toolCall): Message => {
          return {
            id: renderResultId(toolCall.id),
            role: 'tool',
            toolCallId: toolCall.id,
            content: painted.has(a2uiSurfaceActivityId(toolCall.id)) ? A2UI_RENDERED_RESULT : A2UI_CANCELLED_RESULT,
          }
        })
    }

    return [...due, message]
  })

  return [...answeredKept, ...owed]
}

// An edit of the last question is a regenerate whose browser copy of that turn carries new text; only
// that one kept user turn can be rewritten, and only by a user message with the same id.
const withEditedTurn = (stored: Message[], sent: readonly Message[]): Message[] => {
  const turn = stored.at(-1)

  const edited = sent.find((message) => {
    return message.id === turn?.id && message.role === 'user'
  })

  return edited === undefined ? stored : [...stored.slice(0, -1), edited]
}

/**
 * The history a run starts from. The kept transcript is the source of truth; the browser only adds
 * the traveller's new messages and the results of the frontend tools the kept transcript is waiting
 * on. Anything else it sends — an assistant turn, a tool result for a call the server never issued
 * or already answered, a system prompt, an edited copy of a kept message — is dropped, so a caller
 * can neither put words in the assistant's mouth nor forge what a tool returned.
 *
 * A thread paused on an interrupt takes no tool result: its trailing calls are the server tools the
 * pause holds, and they are answered through `resume`, never by the browser.
 *
 * `regenerateFrom` naming the kept transcript's LAST user turn cuts everything kept after it, so the
 * run answers that turn afresh — as edited, when the browser's copy of it has new text. Any other id
 * (an older turn, an unknown one, a turn never kept because its run failed) cuts nothing. A browser
 * copy of a summary marker is dropped unless it is already kept.
 */
export const trustedHistory = (
  kept: KeptHistory | null,
  sent: readonly Message[],
  options: TrustedHistoryOptions = {},
): TrustedHistory => {
  const all = (kept?.messages ?? []) as Message[]
  const cut = lastUserIndex(all)
  const regenerated = options.regenerateFrom !== undefined && cut !== -1 && all[cut]?.id === options.regenerateFrom
  const renderToolNames = options.renderToolNames ?? NO_TOOLS

  // Paused thread or not: a pause holds server calls, and nothing but this ever answers a render call.
  const stored = answerRenderCalls(regenerated ? withEditedTurn(all.slice(0, cut + 1), sent) : all, renderToolNames)

  const known = new Set(
    stored.map((message) => {
      return message.id
    }),
  )

  const paused = !regenerated && (kept?.interrupts?.length ?? 0) > 0
  const awaiting = paused ? new Set<string>() : awaitingBrowserResults(stored, renderToolNames)
  const added: Message[] = []
  const dropped: Record<string, number> = {}

  for (const message of sent) {
    if (known.has(message.id)) continue

    // Only the server writes a summary marker (`programSummaryOf`); a browser copy is never the stored one.
    const accepted =
      (message.role === 'user' && !isProgramSummaryMarker(message)) ||
      (message.role === 'tool' && awaiting.delete(message.toolCallId))

    if (accepted) {
      known.add(message.id)
      added.push(message)
    } else {
      dropped[message.role] = (dropped[message.role] ?? 0) + 1
    }
  }

  const newTurn =
    regenerated ||
    added.some((message) => {
      return message.role === 'user'
    })

  return { messages: [...stored, ...added], dropped, regenerated, newTurn }
}
