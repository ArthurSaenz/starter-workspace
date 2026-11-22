import { RUN_ERROR_MESSAGE } from './lambda-bodies.js'

// Structural stand-in for `BaseEvent` from `@ag-ui/client`, which is not resolvable from this
// package (it reaches the browser only through `@copilotkit/react-core`).
export interface AgUiEvent {
  type: string
  [key: string]: unknown
}

export interface ToolCallFramesInput {
  threadId?: string
  name: string
  args: Record<string, unknown>
  /** Omit to leave the call open for a frontend tool / human-in-the-loop `respond()`. */
  result?: unknown
  /** Assistant text emitted before the call, as a model that talks and then calls a tool does. */
  text?: string
}

export const FAKE_THREAD_ID = 'thread-1'
const RUN_ID = 'run-1'
const MESSAGE_ID = 'm1'
const TOOL_CALL_ID = 'call-1'
// Kept distinct from MESSAGE_ID: react-core materialises the parent as an assistant message,
// and a follow-up run's reply must not collide with it.
const TOOL_PARENT_MESSAGE_ID = 'tool-parent-1'
// `<chunkId>-reasoning`, as InProcessAgent names it: the model chunk that thinks is the one that answers.
const REASONING_MESSAGE_ID = `${MESSAGE_ID}-reasoning`

// Every helper emits RUN_STARTED first because the Lambda does — AG-UI itself accepts
// RUN_ERROR as a first event, so a story that skipped it would still render and prove nothing.
const runStarted = (threadId: string): AgUiEvent => {
  return { type: 'RUN_STARTED', threadId, runId: RUN_ID }
}

const runFinished = (threadId: string): AgUiEvent => {
  return { type: 'RUN_FINISHED', threadId, runId: RUN_ID }
}

// Field names mirror vendor/packages/ai-chat-be/src/copilotkit/inProcessAgent.ts:131-166.
const textFrames = (messageId: string, text: string): AgUiEvent[] => {
  return [
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text },
    { type: 'TEXT_MESSAGE_END', messageId },
  ]
}

// Same shape as `buildRunErrorFrame` in vendor/packages/ai-chat-be/src/lambda/copilotkit.ts:180 —
// `type` and `message` only, no threadId/runId.
const runError = (message: string): AgUiEvent => {
  return { type: 'RUN_ERROR', message }
}

export const replyFrames = (threadId: string, text: string, messageId = MESSAGE_ID): AgUiEvent[] => {
  return [runStarted(threadId), ...textFrames(messageId, text), runFinished(threadId)]
}

export const emptyReplyFrames = (threadId: string): AgUiEvent[] => {
  return [runStarted(threadId), runFinished(threadId)]
}

export const errorFrames = (threadId: string, message = RUN_ERROR_MESSAGE): AgUiEvent[] => {
  return [runStarted(threadId), runError(message)]
}

// The Lambda's deadline path: the partial answer already drained plus a synthetic RUN_ERROR,
// all in one flush (copilotkit.ts:310).
export const partialThenErrorFrames = (
  threadId: string,
  partialText: string,
  message = RUN_ERROR_MESSAGE,
): AgUiEvent[] => {
  return [runStarted(threadId), ...textFrames(MESSAGE_ID, partialText), runError(message)]
}

export const toolCallFrames = (input: ToolCallFramesInput): AgUiEvent[] => {
  const { threadId = FAKE_THREAD_ID, name, args, result, text } = input

  return [
    runStarted(threadId),
    ...(text === undefined ? [] : textFrames(TOOL_PARENT_MESSAGE_ID, text)),
    { type: 'TOOL_CALL_START', toolCallId: TOOL_CALL_ID, toolCallName: name, parentMessageId: TOOL_PARENT_MESSAGE_ID },
    { type: 'TOOL_CALL_ARGS', toolCallId: TOOL_CALL_ID, delta: JSON.stringify(args) },
    { type: 'TOOL_CALL_END', toolCallId: TOOL_CALL_ID },
    // AG-UI expects messageId === toolCallId on a result (inProcessAgent.ts:164).
    ...(result === undefined
      ? []
      : [
          {
            type: 'TOOL_CALL_RESULT',
            messageId: TOOL_CALL_ID,
            toolCallId: TOOL_CALL_ID,
            content: JSON.stringify(result),
            role: 'tool',
          },
        ]),
    runFinished(threadId),
  ]
}

// AG-UI schema has no `threadId` on STATE_SNAPSHOT — only RUN_STARTED/RUN_FINISHED/RUN_ERROR
// carry it (vendor/packages/ai-chat-fe/node_modules/@ag-ui/core dist/index.d.ts StateSnapshotEventSchema).
export const stateSnapshotFrames = (threadId: string, snapshot: Record<string, unknown>): AgUiEvent[] => {
  return [runStarted(threadId), { type: 'STATE_SNAPSHOT', snapshot }, runFinished(threadId)]
}

// REASONING_* (not the deprecated THINKING_* alias): the deprecated schema for
// THINKING_TEXT_MESSAGE_START/CONTENT carries no `messageId`, so it cannot support the same
// per-message identity the rest of this file relies on. REASONING_MESSAGE_START/CONTENT/END do
// (@ag-ui/core ReasoningMessageStartEventSchema declares `role: 'reasoning'`), and CopilotKit's
// client resolves both families to the same rendered message.
export const thinkingFrames = (threadId: string, reasoningText: string, replyText: string): AgUiEvent[] => {
  return [
    runStarted(threadId),
    { type: 'REASONING_START', messageId: REASONING_MESSAGE_ID },
    { type: 'REASONING_MESSAGE_START', messageId: REASONING_MESSAGE_ID, role: 'reasoning' },
    { type: 'REASONING_MESSAGE_CONTENT', messageId: REASONING_MESSAGE_ID, delta: reasoningText },
    { type: 'REASONING_MESSAGE_END', messageId: REASONING_MESSAGE_ID },
    { type: 'REASONING_END', messageId: REASONING_MESSAGE_ID },
    ...textFrames(MESSAGE_ID, replyText),
    runFinished(threadId),
  ]
}

export interface ProgressFramesInput {
  threadId?: string
  /** Tools the one lookup step runs, in call order. */
  tools: string[]
  replyText: string
  /** `RUN_PROGRESS.maxSteps` = 2 + 2 × (LANGGRAPH_MAX_TOOL_HOPS + 1), 8 by default. */
  maxSteps?: number
}

type ProgressPhase = 'thinking' | 'researching' | 'answering' | 'done'

/**
 * A run with one lookup hop as InProcessAgent streams it (`publishProgress`, inProcessAgent.ts):
 * one ACTIVITY_SNAPSHOT when the first `agent` node starts, then an ACTIVITY_DELTA of `replace` ops
 * for only the keys that changed — a step per graph node, a tool per lookup started, `answering` with
 * the first reply token, `done` just before RUN_FINISHED. Batched in arrival order so a `paced` run
 * can space them out. The hop's own TOOL_CALL_* frames are left out: they render nothing without a
 * tool renderer, and this is the progress channel only.
 */
export const progressFrameBatches = (input: ProgressFramesInput): AgUiEvent[][] => {
  const { threadId = FAKE_THREAD_ID, tools, replyText, maxSteps = 8 } = input
  const messageId = `progress-${RUN_ID}`
  const activityType = 'agent-progress'

  const delta = (changes: { phase?: ProgressPhase; step?: number; tools?: string[] }): AgUiEvent => {
    return {
      type: 'ACTIVITY_DELTA',
      messageId,
      activityType,
      patch: Object.entries(changes).map(([key, value]) => {
        return { op: 'replace', path: `/${key}`, value }
      }),
    }
  }

  return [
    [
      runStarted(threadId),
      {
        type: 'ACTIVITY_SNAPSHOT',
        messageId,
        activityType,
        content: { phase: 'thinking', step: 1, maxSteps, tools: [] },
        replace: true,
      },
    ],
    [delta({ phase: 'researching', step: 2 })],
    ...tools.map((_, index) => {
      return [delta({ tools: tools.slice(0, index + 1) })]
    }),
    [delta({ phase: 'thinking', step: 3 })],
    [{ type: 'TEXT_MESSAGE_START', messageId: MESSAGE_ID, role: 'assistant' }, delta({ phase: 'answering' })],
    [
      { type: 'TEXT_MESSAGE_CONTENT', messageId: MESSAGE_ID, delta: replyText },
      { type: 'TEXT_MESSAGE_END', messageId: MESSAGE_ID },
      delta({ phase: 'done' }),
      runFinished(threadId),
    ],
  ]
}

// packages/ai-travel-agent/src/capabilities/value/tripPlan.ts `TripPlan`, the one shared-state channel.
export interface TripPlanHotel {
  hotelId: string
  name: string
  chain: string | null
  area: string | null
  stars: number | null
  /** Set while the model is still writing the call that adds it; cleared once the catalogue confirms it. */
  pending?: boolean
}

export interface TripPlan {
  destination: string | null
  nights: number | null
  hotels: TripPlanHotel[]
  programmes: Array<{ programmeId: string; chain: string | null }>
}

export const EMPTY_TRIP_PLAN: TripPlan = { destination: null, nights: null, hotels: [], programmes: [] }

export const TRIP_PLAN_TOOL_NAME = 'update_trip_plan'

export interface TripPlanFramesInput {
  threadId?: string
  /** The rest of `RunAgentInput.state`; the Lambda echoes it beside `tripPlan` in the STATE_SNAPSHOT. */
  browserState?: Record<string, unknown>
  /** The plan the browser sent, already valid — the baseline STATE_SNAPSHOT. */
  plan?: TripPlan
  destination?: string
  nights?: number
  /** The hotels `update_trip_plan` adds, with the facts the catalogue fills in once the tool runs. */
  hotels: Array<Omit<TripPlanHotel, 'pending'>>
  replyText: string
  /** `failed`: the run dies once the arguments have streamed, and the prediction is reverted. */
  outcome?: 'saved' | 'failed'
}

const TRIP_PLAN_CALL_ID = 'call-trip-plan'
const TRIP_PLAN_PARENT_ID = 'trip-plan-parent'
const TRIP_PLAN_REPLY_ID = 'trip-plan-reply'

// The whole plan in one `replace`, as `diffTopLevel` patches it: the snapshot always carries
// `tripPlan`, so the op is never `add`.
const tripPlanDelta = (plan: TripPlan): AgUiEvent => {
  return { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/tripPlan', value: plan }] }
}

const toolCallArgs = (delta: string): AgUiEvent => {
  return { type: 'TOOL_CALL_ARGS', toolCallId: TRIP_PLAN_CALL_ID, delta }
}

/**
 * A turn in which the agent adds hotels to the trip plan, as InProcessAgent streams it with
 * `SHARED_STATE`: the baseline STATE_SNAPSHOT after RUN_STARTED; `update_trip_plan`'s arguments in
 * several TOOL_CALL_ARGS, each followed by the STATE_DELTA `predictTripPlan` makes of them (only
 * when the projection changed, as `publishState` skips an empty diff); then TOOL_CALL_RESULT and
 * the authoritative STATE_DELTA when the tool node ends, and the reply. The argument chunks end
 * where `parsePartialJson` + `dropUnfinishedEntries` give exactly the projection built here: after
 * a hotel's id a hotel without a name is dropped, after its closing brace it shows as `pending`.
 * One batch per chunk so a `paced` run shows the plan filling in.
 */
export const tripPlanFrameBatches = (input: TripPlanFramesInput): AgUiEvent[][] => {
  const {
    threadId = FAKE_THREAD_ID,
    browserState = {},
    plan = EMPTY_TRIP_PLAN,
    destination,
    nights,
    hotels,
    replyText,
    outcome = 'saved',
  } = input

  const head: TripPlan = {
    ...plan,
    ...(destination === undefined ? {} : { destination }),
    ...(nights === undefined ? {} : { nights }),
  }

  const headArgs = JSON.stringify({
    ...(destination === undefined ? {} : { destination }),
    ...(nights === undefined ? {} : { nights }),
    addHotels: [],
  }).slice(0, -2)

  const changesHead = head.destination !== plan.destination || head.nights !== plan.nights

  const hotelBatches = hotels.flatMap((hotel, index): AgUiEvent[][] => {
    const projected: TripPlan = {
      ...head,
      hotels: [
        ...plan.hotels,
        ...hotels.slice(0, index + 1).map(({ hotelId, name }) => {
          return { hotelId, name, chain: null, area: null, stars: null, pending: true }
        }),
      ],
    }

    const separator = index < hotels.length - 1 ? ',' : ''

    return [
      [toolCallArgs(`{"hotelId":${JSON.stringify(hotel.hotelId)},`)],
      [toolCallArgs(`"name":${JSON.stringify(hotel.name)}}${separator}`), tripPlanDelta(projected)],
    ]
  })

  const saved: TripPlan = { ...head, hotels: [...plan.hotels, ...hotels] }

  const ending: AgUiEvent[][] =
    outcome === 'failed'
      ? // The catch path: the open streams close, the committed plan is republished, the run errors.
        [[tripPlanDelta(plan), runError(RUN_ERROR_MESSAGE)]]
      : [
          [
            {
              type: 'TOOL_CALL_RESULT',
              messageId: TRIP_PLAN_CALL_ID,
              toolCallId: TRIP_PLAN_CALL_ID,
              content: JSON.stringify({ plan: saved, rejectedHotelIds: [] }),
              role: 'tool',
            },
            tripPlanDelta(saved),
          ],
          [...textFrames(TRIP_PLAN_REPLY_ID, replyText), runFinished(threadId)],
        ]

  return [
    [runStarted(threadId), { type: 'STATE_SNAPSHOT', snapshot: { ...browserState, tripPlan: plan } }],
    [
      {
        type: 'TOOL_CALL_START',
        toolCallId: TRIP_PLAN_CALL_ID,
        toolCallName: TRIP_PLAN_TOOL_NAME,
        parentMessageId: TRIP_PLAN_PARENT_ID,
      },
      toolCallArgs(headArgs),
      ...(changesHead ? [tripPlanDelta(head)] : []),
    ],
    ...hotelBatches,
    [toolCallArgs(']}'), { type: 'TOOL_CALL_END', toolCallId: TRIP_PLAN_CALL_ID }],
    ...ending,
  ]
}

/** A plain reply whose STATE_SNAPSHOT echoes the state the browser sent, as every Lambda run starts. */
export const stateEchoReplyFrames = (
  threadId: string,
  state: Record<string, unknown>,
  text: string,
  messageId = MESSAGE_ID,
): AgUiEvent[] => {
  const { tripPlan = EMPTY_TRIP_PLAN, ...rest } = state

  return [
    runStarted(threadId),
    { type: 'STATE_SNAPSHOT', snapshot: { ...rest, tripPlan } },
    ...textFrames(messageId, text),
    runFinished(threadId),
  ]
}

export interface InterruptFrameInput {
  id: string
  reason: string
  message?: string
  toolCallId?: string
  expiresAt?: string
  metadata?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
}

/** The answer's JSON Schema the travel agent sends on a trip-plan confirmation (`z.toJSONSchema`). */
export const TRIP_PLAN_CONFIRMATION_RESPONSE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { approved: { type: 'boolean' } },
  required: ['approved'],
  additionalProperties: false,
}

// LangGraph's interrupt() ends the run itself — RUN_FINISHED.outcome carries the interrupt list,
// there is no separate RUN_ERROR or a trailing RUN_FINISHED (@ag-ui/core RunFinishedEventSchema).
export const interruptOutcomeFrames = (
  threadId: string,
  interrupts: InterruptFrameInput[],
  runId = RUN_ID,
): AgUiEvent[] => {
  return [
    { type: 'RUN_STARTED', threadId, runId },
    { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'interrupt', interrupts } },
  ]
}

// packages/ai-travel-agent/src/capabilities/value/tripPlan.ts `TRIP_PLAN_CONFIRM_KIND` / `TripPlanConfirmation`.
export const TRIP_PLAN_CONFIRM_REASON = 'confirm_trip_plan_change'

export interface TripPlanConfirmation {
  kind: typeof TRIP_PLAN_CONFIRM_REASON
  removals: { hotels: Array<{ hotelId: string; name: string }>; programmes: string[] }
  changes: { destination?: { from: string; to: string }; nights?: { from: number; to: number } }
}

/** The `update_trip_plan` arguments a destructive turn sends (`TripPlanUpdateSchema`, removals and overwrites only). */
export interface TripPlanChange {
  removeHotelIds?: string[]
  removeProgrammeIds?: string[]
  destination?: string
  nights?: number
}

// The LangGraph half of an interrupt id (`isXXH3`): any 32 lower-case hex digits.
const LANGGRAPH_INTERRUPT_ID = '9f86d081884c7d659a2feaa0c55ad015'

/** `<run that paused>~<LangGraph interrupt id>`, as `InProcessAgent.readInterrupts` names it. */
export const interruptIdFor = (runId: string): string => {
  return `${runId}~${LANGGRAPH_INTERRUPT_ID}`
}

/** `findTripPlanConfirmation` for one call: what `change` would take away from `plan`. */
export const tripPlanConfirmationOf = (plan: TripPlan, change: TripPlanChange): TripPlanConfirmation => {
  const overwrite = <T>(from: T | null, to: T | undefined) => {
    return from !== null && to !== undefined && to !== from ? { from, to } : undefined
  }

  const destination = overwrite(plan.destination, change.destination)
  const nights = overwrite(plan.nights, change.nights)

  return {
    kind: TRIP_PLAN_CONFIRM_REASON,
    removals: {
      hotels: plan.hotels
        .filter((hotel) => {
          return change.removeHotelIds?.includes(hotel.hotelId)
        })
        .map(({ hotelId, name }) => {
          return { hotelId, name }
        }),
      programmes: plan.programmes
        .map((programme) => {
          return programme.programmeId
        })
        .filter((programmeId) => {
          return change.removeProgrammeIds?.includes(programmeId)
        }),
    },
    changes: {
      ...(destination === undefined ? {} : { destination }),
      ...(nights === undefined ? {} : { nights }),
    },
  }
}

// Copied from `describeTripPlanConfirmation`: the card's fallback sentence.
const describeTripPlanConfirmation = (confirmation: TripPlanConfirmation): string => {
  const { removals, changes } = confirmation

  const parts = [
    ...removals.hotels.map((hotel) => {
      return `remove ${hotel.name || hotel.hotelId}`
    }),
    ...removals.programmes.map((programmeId) => {
      return `remove ${programmeId}`
    }),
    ...(changes.destination ? [`change the destination to ${changes.destination.to}`] : []),
    ...(changes.nights ? [`change the stay to ${changes.nights.to} nights`] : []),
  ]

  const list = parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`

  return `The assistant wants to ${list} in your trip plan. Allow it?`
}

const applyTripPlanChange = (plan: TripPlan, change: TripPlanChange): TripPlan => {
  return {
    destination: change.destination ?? plan.destination,
    nights: change.nights ?? plan.nights,
    hotels: plan.hotels.filter((hotel) => {
      return !change.removeHotelIds?.includes(hotel.hotelId)
    }),
    programmes: plan.programmes.filter((programme) => {
      return !change.removeProgrammeIds?.includes(programme.programmeId)
    }),
  }
}

export interface TripPlanInterruptFramesInput {
  threadId?: string
  /** The browser's run id: the interrupt id is built from it, and react-core resumes on the same one. */
  runId?: string
  /** The plan the browser sent, already valid — the baseline STATE_SNAPSHOT and what the change is checked against. */
  plan: TripPlan
  change: TripPlanChange
  /** The rest of `RunAgentInput.state`, echoed beside `tripPlan`. */
  browserState?: Record<string, unknown>
  /** Defaults to 24 hours from now, `INTERRUPT_TTL_MS`. */
  expiresAt?: string
}

/** The interrupt `InProcessAgent` advertises for `change` against `plan`. */
export const tripPlanInterruptOf = (input: TripPlanInterruptFramesInput): InterruptFrameInput => {
  const { runId = RUN_ID, plan, change, expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } = input
  const confirmation = tripPlanConfirmationOf(plan, change)

  return {
    id: interruptIdFor(runId),
    reason: TRIP_PLAN_CONFIRM_REASON,
    message: describeTripPlanConfirmation(confirmation),
    expiresAt,
    metadata: { ...confirmation },
    responseSchema: TRIP_PLAN_CONFIRMATION_RESPONSE_SCHEMA,
  }
}

/**
 * A turn whose `update_trip_plan` would take something away, as InProcessAgent streams it with
 * checkpoints: the baseline STATE_SNAPSHOT, the model's call streamed in full (a removal or an
 * overwrite is never predicted, so no STATE_DELTA), then `interrupt()` pauses the tool node and the
 * run ends on ONE RUN_FINISHED carrying the interrupt — no tool result, no reply text.
 */
export const tripPlanInterruptFrames = (input: TripPlanInterruptFramesInput): AgUiEvent[] => {
  const { threadId = FAKE_THREAD_ID, runId = RUN_ID, plan, change, browserState = {} } = input

  return [
    { type: 'RUN_STARTED', threadId, runId },
    { type: 'STATE_SNAPSHOT', snapshot: { ...browserState, tripPlan: plan } },
    {
      type: 'TOOL_CALL_START',
      toolCallId: TRIP_PLAN_CALL_ID,
      toolCallName: TRIP_PLAN_TOOL_NAME,
      parentMessageId: TRIP_PLAN_PARENT_ID,
    },
    toolCallArgs(JSON.stringify(change)),
    { type: 'TOOL_CALL_END', toolCallId: TRIP_PLAN_CALL_ID },
    { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'interrupt', interrupts: [tripPlanInterruptOf(input)] } },
  ]
}

export interface TripPlanResumeFramesInput extends TripPlanInterruptFramesInput {
  /** `resume[0].status === 'resolved'` with `payload.approved === true`; anything else is a refusal. */
  approved: boolean
  replyText: string
}

/**
 * The run that answers the interrupt (`RunAgentInput.resume`): the checkpointed plan as the
 * STATE_SNAPSHOT, the paused tool node finishing — its TOOL_CALL_RESULT, and on approval the
 * STATE_DELTA of the changed plan; a refusal returns `{ declined, plan }` and leaves the plan alone
 * — then the reply.
 */
export const tripPlanResumeFrames = (input: TripPlanResumeFramesInput): AgUiEvent[] => {
  const { threadId = FAKE_THREAD_ID, runId = RUN_ID, plan, change, browserState = {}, approved, replyText } = input
  const saved = approved ? applyTripPlanChange(plan, change) : plan

  const content = approved
    ? { plan: saved, rejectedHotelIds: [] }
    : {
        declined:
          'the traveller declined this change, so the trip plan is unchanged; do not try it again unless they ask',
        plan,
      }

  return [
    { type: 'RUN_STARTED', threadId, runId },
    { type: 'STATE_SNAPSHOT', snapshot: { ...browserState, tripPlan: plan } },
    {
      type: 'TOOL_CALL_RESULT',
      messageId: TRIP_PLAN_CALL_ID,
      toolCallId: TRIP_PLAN_CALL_ID,
      content: JSON.stringify(content),
      role: 'tool',
    },
    ...(approved ? [tripPlanDelta(saved)] : []),
    ...textFrames(TRIP_PLAN_REPLY_ID, replyText),
    { type: 'RUN_FINISHED', threadId, runId },
  ]
}

// The basic catalogs a surface names: v0.9 in chats kept before the 1.0 catalog, 1.0 since
// (`A2UI_RUNTIME_OPTIONS.defaultCatalogId`, packages/ai-travel-agent).
export const A2UI_BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'
export const A2UI_BASIC_CATALOG_ID_V1_0 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'

export type A2uiProtocol = 'v0.9' | '1.0'

/** A painted surface's operations as the middleware streams them for a catalog of that protocol. */
export const a2uiSurfaceOperations = (
  surfaceId: string,
  components: Array<Record<string, unknown>>,
  version: A2uiProtocol = 'v0.9',
): Array<Record<string, unknown>> => {
  const catalogId = version === '1.0' ? A2UI_BASIC_CATALOG_ID_V1_0 : A2UI_BASIC_CATALOG_ID

  return [
    { version, createSurface: { surfaceId, catalogId } },
    { version, updateComponents: { surfaceId, components } },
  ]
}

export interface A2uiSurfaceFramesInput {
  threadId?: string
  surfaceId: string
  /** Flat components, as the model passes them to `render_a2ui`. */
  components: Array<Record<string, unknown>>
  /** The protocol the server catalog declares; v0.9 by default. */
  version?: A2uiProtocol
  /** The sentence the model writes before the call (the run ends with the surface). */
  text?: string
  /** Per run: a second surface in one transcript needs its own call id (and so activity id). */
  toolCallId?: string
}

/**
 * A `render_a2ui` turn as the Lambda streams it with `@ag-ui/a2ui-middleware` 0.0.16 attached: the
 * middleware emits a `building` lifecycle snapshot ahead of TOOL_CALL_START and the painted surface
 * (`createSurface` + `updateComponents`) ahead of the args, both on `a2ui-surface-<toolCallId>`,
 * then answers the call itself (`{"status":"rendered"}`, its own message id) right before RUN_FINISHED.
 */
export const a2uiSurfaceFrames = (input: A2uiSurfaceFramesInput): AgUiEvent[] => {
  const { threadId = FAKE_THREAD_ID, surfaceId, components, text, toolCallId = 'render-call-1', version } = input
  const messageId = `a2ui-surface-${toolCallId}`

  const activity = (content: Record<string, unknown>): AgUiEvent => {
    return { type: 'ACTIVITY_SNAPSHOT', messageId, activityType: 'a2ui-surface', content, replace: true }
  }

  return [
    runStarted(threadId),
    ...(text === undefined ? [] : textFrames(TOOL_PARENT_MESSAGE_ID, text)),
    activity({ status: 'building', debugExposure: 'hidden' }),
    { type: 'TOOL_CALL_START', toolCallId, toolCallName: 'render_a2ui', parentMessageId: TOOL_PARENT_MESSAGE_ID },
    activity({ a2ui_operations: a2uiSurfaceOperations(surfaceId, components, version) }),
    { type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify({ surfaceId, components }) },
    { type: 'TOOL_CALL_END', toolCallId },
    {
      type: 'TOOL_CALL_RESULT',
      messageId: `${toolCallId}-rendered`,
      toolCallId,
      content: JSON.stringify({ status: 'rendered' }),
      role: 'tool',
    },
    runFinished(threadId),
  ]
}

export interface OpenGenerativeUiFramesInput {
  threadId?: string
  initialHeight?: number
  placeholderMessages?: string[]
  css: string
  html: string
}

/**
 * A `generateSandboxedUi` turn as the runtime's built-in `OpenGenerativeUIMiddleware` streams it
 * (`@copilotkit/runtime` 1.90.0): an `open-generative-ui` snapshot on `<toolCallId>-activity`, then one
 * ACTIVITY_DELTA per parameter as the args parse — css, the html in chunks, `generating: false` at
 * TOOL_CALL_END. The tool is the browser's own, so the run ends with the call unanswered.
 */
export const openGenerativeUiFrames = (input: OpenGenerativeUiFramesInput): AgUiEvent[] => {
  const { threadId = FAKE_THREAD_ID, initialHeight = 180, placeholderMessages = ['Drawing it…'], css, html } = input
  const toolCallId = 'sandbox-call-1'
  const messageId = `${toolCallId}-activity`
  const activityType = 'open-generative-ui'

  const add = (path: string, value: unknown): AgUiEvent => {
    return { type: 'ACTIVITY_DELTA', messageId, activityType, patch: [{ op: 'add', path, value }] }
  }

  const half = Math.ceil(html.length / 2)

  return [
    runStarted(threadId),
    { type: 'ACTIVITY_SNAPSHOT', messageId, activityType, content: { initialHeight, generating: true } },
    {
      type: 'TOOL_CALL_START',
      toolCallId,
      toolCallName: 'generateSandboxedUi',
      parentMessageId: TOOL_PARENT_MESSAGE_ID,
    },
    {
      type: 'TOOL_CALL_ARGS',
      toolCallId,
      delta: JSON.stringify({ initialHeight, placeholderMessages, css, html }),
    },
    add('/placeholderMessages', []),
    ...placeholderMessages.map((message) => {
      return add('/placeholderMessages/-', message)
    }),
    add('/css', css),
    add('/cssComplete', true),
    add('/html', []),
    add('/html/-', html.slice(0, half)),
    add('/html/-', html.slice(half)),
    add('/htmlComplete', true),
    add('/generating', false),
    { type: 'TOOL_CALL_END', toolCallId },
    runFinished(threadId),
  ]
}

// One buffered body: API Gateway delivers the whole SSE response at once (apps/ai/ARCHITECTURE.md).
export const encodeSse = (frames: AgUiEvent[]): string => {
  return frames
    .map((frame) => {
      return `data: ${JSON.stringify(frame)}\n\n`
    })
    .join('')
}
