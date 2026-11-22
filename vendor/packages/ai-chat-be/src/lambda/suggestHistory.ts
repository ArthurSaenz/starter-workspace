import type { Message } from '@ag-ui/client'
import path from 'node:path'

import type { KeptHistory } from '../copilotkit/trustedHistory.js'
import { trustedHistory } from '../copilotkit/trustedHistory.js'
import { consoleJsonLogger } from '../ports.js'
import type { ChatLoggerFactory } from '../ports.js'
import { withinGateDeadline } from './usage.js'

const filename = path.basename(import.meta.url)

const CHAT_ID_PATTERN = /^[\w-]{1,64}$/

// The browser asks for suggestions on RUN_FINISHED, which the runner emits before its write of the
// turn lands (customerChatsRunner.ts `persist`), so the first read can miss the answer just given.
export const SUGGEST_READ_ATTEMPTS = 4
export const SUGGEST_READ_GAP_MS = 400

/** The browser tool CopilotKit's suggestion engine forces; the only one a suggestion may call. */
export const SUGGEST_TOOL_NAME = 'copilotkitSuggest'

/**
 * The suggestion tool as the server declares it to the model, whatever the browser sent: a description
 * the browser wrote would be text the traveller never sees steering the run. The same name, schema and
 * wording as `SUGGEST_TOOL` in `@copilotkit/core` 1.90.0, so the browser parses the call it gets back.
 */
export const SUGGEST_TOOL = {
  name: SUGGEST_TOOL_NAME,
  description: 'Suggest what the user could say next',
  parameters: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        description: 'List of suggestions shown to the user as buttons.',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'The title of the suggestion. This is shown as a button and should be short.',
            },
            message: {
              type: 'string',
              description:
                'The message to send when the suggestion is clicked. This should be a clear, complete sentence and will be sent as an instruction to the AI.',
            },
          },
          required: ['title', 'message'],
        },
      },
    },
    required: ['suggestions'],
  },
} as const

interface SuggestBody {
  tools?: unknown
  messages?: unknown
  threadId?: unknown
  resume?: unknown
  forwardedProps?: unknown
}

export type ReadKeptChat = (customerId: string, threadId: string) => Promise<KeptHistory | null>

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const holds = (kept: KeptHistory | null, id: string | undefined): boolean => {
  return (
    id === undefined ||
    (kept?.messages ?? []).some((message) => {
      return (message as { id?: unknown }).id === id
    })
  )
}

const readSettled = async (
  read: ReadKeptChat,
  customerId: string,
  threadId: string,
  lastSentId: string | undefined,
): Promise<KeptHistory | null> => {
  let kept: KeptHistory | null = null

  for (let attempt = 1; attempt <= SUGGEST_READ_ATTEMPTS; attempt += 1) {
    kept = await read(customerId, threadId)

    if (holds(kept, lastSentId) || attempt === SUGGEST_READ_ATTEMPTS) return kept

    await sleep(SUGGEST_READ_GAP_MS)
  }

  return kept
}

/**
 * The suggestion route is a stateless run the runner never sees, so without this the model would
 * read whatever transcript the browser posts. The body's `messages` become the traveller's kept
 * chat, plus only what `trustedHistory` lets a browser add (new user turns): an assistant turn or a
 * tool result the server never wrote cannot steer the suggestions. A body that is not a JSON object
 * passes unchanged; the runtime refuses it. A store that cannot be read in time leaves only the
 * browser's user turns, the same strictest history a run falls back to.
 *
 * The run is pinned to the suggestion tool: the graph honours a forced tool only when the browser
 * declared it, and without one it runs a full chat turn — the main model and every server tool —
 * that no daily run count covers. `undefined`: the body declares no suggestion tool and is refused.
 */
export const trustedSuggestBody = async (
  rawBody: string | null,
  customerId: string,
  {
    read,
    dropConnections,
    createLogger = consoleJsonLogger,
  }: { read: ReadKeptChat; dropConnections: () => void; createLogger?: ChatLoggerFactory },
): Promise<string | null | undefined> => {
  if (rawBody === null) return null

  const logger = createLogger(filename)

  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return rawBody
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return rawBody

  // `resume` and the other forwarded props are dropped too: a suggestion must not answer a paused question.
  const body = { ...(parsed as SuggestBody) }

  delete body.resume
  delete body.forwardedProps

  const declaresSuggestTool = (Array.isArray(body.tools) ? body.tools : []).some((tool: unknown) => {
    return (tool as { name?: unknown } | null)?.name === SUGGEST_TOOL_NAME
  })

  if (!declaresSuggestTool) {
    logger.warn('suggestion refused: the body declares no suggestion tool')

    return undefined
  }

  const sent = (Array.isArray(body.messages) ? body.messages : []) as Message[]
  const threadId = typeof body.threadId === 'string' && CHAT_ID_PATTERN.test(body.threadId) ? body.threadId : undefined
  let kept: KeptHistory | null = null

  if (threadId !== undefined) {
    try {
      kept = await withinGateDeadline(readSettled(read, customerId, threadId, sent.at(-1)?.id), {
        what: 'suggestion history read',
        dropConnections,
        createLogger,
      })
    } catch (error) {
      logger.error('suggestion history not read: only the browser user turns are used', { error: String(error) })
    }
  }

  const { messages, dropped } = trustedHistory(kept, sent)

  if (Object.keys(dropped).length > 0) {
    logger.info('suggestion history: browser messages dropped', { kept: kept !== null, dropped })
  }

  return JSON.stringify({
    ...body,
    messages,
    tools: [SUGGEST_TOOL],
    forwardedProps: { toolChoice: { type: 'function', function: { name: SUGGEST_TOOL_NAME } } },
  })
}
