import type { RuntimeScenario } from './fake-runtime.js'
import {
  FAKE_THREAD_ID,
  a2uiSurfaceFrames,
  emptyReplyFrames,
  errorFrames,
  openGenerativeUiFrames,
  partialThenErrorFrames,
  progressFrameBatches,
  replyFrames,
  stateEchoReplyFrames,
  thinkingFrames,
  toolCallFrames,
  tripPlanFrameBatches,
  tripPlanInterruptFrames,
  tripPlanResumeFrames,
} from './frames.js'
import type { TripPlan, TripPlanChange } from './frames.js'
import { RUN_TIMEOUT_MESSAGE, TRANSCRIPTION_RATE_LIMITED_BODY } from './lambda-bodies.js'

export const REPLY = 'Sure, Ada — a three-week stay is where elite benefits start to matter.'

export const SUGGESTION_REPLY =
  'For a three-week stay in Bangkok, think in totals: room rate × 21 nights, then subtract what status and a long-stay rate give back.'

export const PARTIAL_REPLY = 'Bangkok in the rainy season is quieter and rates drop, but'

export const HITL_REPLY = 'Great — I will keep it under $4,200.'

export const TOOL_CALL = {
  name: 'showHotelCard',
  args: { name: 'Mandarin Oriental Bangkok', nights: 21 },
  result: { shown: true },
}

export const HITL_TOOL_CALL = {
  name: 'confirmBudget',
  args: { budgetUsd: 4200 },
}

// Long enough (> 40 lines) that the transcript has to scroll, with every block type the chat renders.
export const MARKDOWN_REPLY = `# Three weeks in Bangkok — the honest total

A long stay is priced differently from a holiday. Here is how to think about it.

## What moves the number

1. **Nightly rate** — the headline, but rarely what you pay.
2. **Long-stay rate** — most chains discount from night 14 or 21.
3. **Elite benefits** — breakfast, lounge, late check-out; worth real money over 21 nights.
4. **Taxes and service** — 17.7% in Thailand, on top of everything.
5. **Points earned** — a rebate you cash later, not now.

## A worked example

| Line item | Per night | 21 nights |
| --- | --- | --- |
| Room (flexible rate) | $180 | $3,780 |
| Long-stay discount (15%) | -$27 | -$567 |
| Breakfast for two (elite) | $0 | $0 |
| Tax + service (17.7%) | $27 | $569 |
| **Total** | **$180** | **$3,782** |

## The maths, if you want to check it

\`\`\`ts
const nights = 21
const rate = 180
const longStayDiscount = 0.15
const taxAndService = 0.177

const room = nights * rate * (1 - longStayDiscount)
const total = room * (1 + taxAndService)

console.log(total.toFixed(0)) // 3782
\`\`\`

## Where status actually helps

- **Breakfast** — $25–40 per person per day in a Bangkok five-star; over 21 days it is the single biggest benefit.
- **Lounge access** — evening cocktails and snacks; easily a light dinner.
- **Upgrade certainty** — a suite for the price of a room, when the hotel is not full.
- **Late check-out** — one extra half-day, which matters on a red-eye.

## Three things to ask the hotel directly

- Is there a long-stay rate below the public one?
- Does the negotiated rate still earn points and status nights?
- Can the club-lounge benefit be swapped for a room credit?

## Bottom line

> Budget the room at the long-stay rate, add tax, then subtract the breakfast you will not buy.
> That is your real number. Everything else is upside.

Tell me the hotel and I will run these numbers for it.
`

export const BACKEND_TOOL_CALL = {
  name: 'lookupLoyaltyBalance',
  args: { programme: 'Marriott Bonvoy' },
  result: { points: 128000 },
}

// The catalogue facts `applyTripPlanUpdate` fills in, shaped as vendor/packages/ai-chat-be's tests seed them.
export const TRIP_PLAN_HOTELS = [
  { hotelId: 'hotel-park-hyatt-bangkok', name: 'Park Hyatt Bangkok', chain: 'hyatt', area: 'ploenchit', stars: 5 },
  {
    hotelId: 'hotel-jw-marriott-bangkok',
    name: 'JW Marriott Hotel Bangkok',
    chain: 'marriott',
    area: 'sukhumvit',
    stars: 5,
  },
]

export const TRIP_PLAN_REPLY = 'I have shortlisted Park Hyatt Bangkok and JW Marriott Hotel Bangkok for your 21 nights.'

export const TRIP_PLAN_EDIT_REPLY = 'Noted — one hotel on the plan now, and the nights as you set them.'

// Slow enough to watch each hotel arrive pending and then confirmed; tests wait on the DOM, not the clock.
const TRIP_PLAN_GAP_MS = 900

const tripPlanTurn = (outcome: 'saved' | 'failed') => {
  return {
    kind: 'paced',
    batches: tripPlanFrameBatches({
      destination: 'Bangkok',
      nights: 21,
      hotels: TRIP_PLAN_HOTELS,
      replyText: TRIP_PLAN_REPLY,
      outcome,
    }),
    gapMs: TRIP_PLAN_GAP_MS,
  } as const
}

export const REASONING_TEXT = 'Weighing the long-stay rate against the flexible rate before answering.'

export const PROGRESS_TOOLS = ['hotels_search', 'hotel_detail']

export const PROGRESS_REPLY = 'Three Bangkok hotels earn Marriott Bonvoy points on a 21-night stay.'

// Long enough per batch to read each phase on the canvas; tests wait on the DOM, not the clock.
const PROGRESS_GAP_MS = 900

/** The plan a destructive turn starts from: the browser holds it (`agent.setState`) before the run. */
export const TRIP_PLAN_TO_CONFIRM: TripPlan = {
  destination: 'Bangkok',
  nights: 21,
  hotels: TRIP_PLAN_HOTELS,
  programmes: [],
}

/** "Drop Park Hyatt": a removal of a hotel the plan holds, so the backend asks first. */
export const TRIP_PLAN_REMOVAL: TripPlanChange = { removeHotelIds: ['hotel-park-hyatt-bangkok'] }

export const TRIP_PLAN_REMOVED_REPLY = 'Done — Park Hyatt Bangkok is off your plan; JW Marriott Hotel Bangkok stays.'

export const TRIP_PLAN_KEPT_REPLY = 'Understood — I left your trip plan as it was.'

export const A2UI_SURFACE_ID = 'compare-bangkok-hyatt-marriott'

export const A2UI_INTRO = 'Here are the two hotels side by side, from the NomaDream catalogue.'

export const A2UI_ADD_ACTION = 'add_to_trip_plan'

export const A2UI_ACTION_REPLY = 'Park Hyatt Bangkok is on your trip plan now.'

const hotelCard = (index: number, hotel: (typeof TRIP_PLAN_HOTELS)[number]): Array<Record<string, unknown>> => {
  const id = (part: string) => {
    return `${part}-${index}`
  }

  return [
    { id: id('card'), component: 'Card', child: id('col') },
    { id: id('col'), component: 'Column', children: [id('name'), id('facts'), id('add')] },
    { id: id('name'), component: 'Text', text: hotel.name, variant: 'h4' },
    {
      id: id('facts'),
      component: 'Text',
      text: `${hotel.stars} stars · ${hotel.area} · ${hotel.chain}`,
      variant: 'body',
    },
    {
      id: id('add'),
      component: 'Button',
      child: id('add-label'),
      variant: 'primary',
      action: { event: { name: A2UI_ADD_ACTION, context: { hotelId: hotel.hotelId, hotelName: hotel.name } } },
    },
    { id: id('add-label'), component: 'Text', text: 'Add to trip plan' },
  ]
}

/** What the Lambda's catalog guidance asks for: title, one Card per hotel in a Row, a source caption. */
export const A2UI_COMPARISON_COMPONENTS: Array<Record<string, unknown>> = [
  { id: 'root', component: 'Column', children: ['title', 'cards', 'source'] },
  { id: 'title', component: 'Text', text: 'Bangkok: Park Hyatt vs JW Marriott', variant: 'h3' },
  { id: 'cards', component: 'Row', children: ['card-1', 'card-2'] },
  ...TRIP_PLAN_HOTELS.flatMap((hotel, index) => {
    return hotelCard(index + 1, hotel)
  }),
  { id: 'source', component: 'Text', text: 'Source: NomaDream catalogue', variant: 'caption' },
]

export const OPEN_GENUI_HTML =
  '<div class="stay"><h3>21 nights in Bangkok</h3><p>Park Hyatt Bangkok · JW Marriott Hotel Bangkok</p></div>'

export const OPEN_GENUI_REPLY = 'That is the stay at a glance.'

// Neutral on purpose: the graph reads text only, so the canvas must not show the assistant claiming
// to have read a file — the story asserts the part on the wire, never this text.
export const ATTACHMENT_REPLY = 'Got your message and the attachment.'

export const VOICE_TRANSCRIPT = 'Which Bangkok hotels are on World of Hyatt for three weeks?'

export const scenarios = {
  default: { run: { kind: 'reply', text: REPLY } },
  suggestionClick: { run: { kind: 'reply', text: SUGGESTION_REPLY } },
  markdownReply: { run: { kind: 'reply', text: MARKDOWN_REPLY } },
  emptyReply: { run: { kind: 'frames', frames: emptyReplyFrames(FAKE_THREAD_ID) } },
  thinking: { run: { kind: 'hang' } },
  // A delayed reply, not `hang`: this CopilotKit never aborts the run fetch on stop (it only POSTs
  // `/stop/:threadId`), so a hanging run would leave the story spinning forever. The delay is the
  // window in which the stop click is observed; the reply then ends the run the way the buffered
  // Lambda response does.
  stopGeneration: { run: { kind: 'reply', text: REPLY, delayMs: 3000 }, stop: 'ok' },
  runError: { run: { kind: 'frames', frames: errorFrames(FAKE_THREAD_ID) } },
  partialThenRunError: {
    run: { kind: 'frames', frames: partialThenErrorFrames(FAKE_THREAD_ID, PARTIAL_REPLY, RUN_TIMEOUT_MESSAGE) },
  },
  runErrorThenRetry: {
    run: [
      { kind: 'frames', frames: errorFrames(FAKE_THREAD_ID) },
      { kind: 'reply', text: REPLY },
    ],
  },
  http401: { run: { kind: 'http', status: 401 } },
  infoUnauthorized: { info: 'unauthorized' },
  infoUnauthorizedOnce: { info: 'unauthorized-once' },
  http404: { run: { kind: 'http', status: 404 } },
  http413: { run: { kind: 'http', status: 413 } },
  http429: { run: { kind: 'http', status: 429 } },
  http500: { run: { kind: 'http', status: 500 } },
  networkError: { run: { kind: 'network-error' } },
  toolCall: { run: { kind: 'frames', frames: toolCallFrames(TOOL_CALL) } },
  // No result on the first run: the frontend tool / human answers and react-core re-runs.
  humanInTheLoop: {
    run: [
      { kind: 'frames', frames: toolCallFrames(HITL_TOOL_CALL) },
      { kind: 'frames', frames: replyFrames(FAKE_THREAD_ID, HITL_REPLY, 'm2') },
    ],
  },
  // Same wire shape as `toolCall` — the fake cannot tell a frontend tool from a backend-rendered
  // one apart, only the story's `renderToolCalls` config does.
  backendToolCall: { run: { kind: 'frames', frames: toolCallFrames(BACKEND_TOOL_CALL) } },
  tripPlan: { run: tripPlanTurn('saved') },
  // The same turn in one flush: the panel reads where the snapshot and deltas end, not each step.
  tripPlanAtOnce: { run: { kind: 'frames', frames: tripPlanTurn('saved').batches.flat() } },
  tripPlanRunFails: { run: tripPlanTurn('failed') },
  // The second run answers with the Lambda's echo of what the browser sent, so an edit made between
  // the turns shows up as that run's STATE_SNAPSHOT.
  tripPlanThenEdit: {
    run: (runIndex, body) => {
      if (runIndex === 0) return tripPlanTurn('saved')

      return {
        kind: 'frames',
        frames: stateEchoReplyFrames(FAKE_THREAD_ID, body.state ?? {}, TRIP_PLAN_EDIT_REPLY, `m${runIndex + 1}`),
      }
    },
  },
  // Named `reasoningMessage`, not `thinking` — that name is already `scenarios.thinking` above
  // (the indefinite-hang loading-cursor demo); the two are unrelated CopilotKit features.
  reasoningMessage: { run: { kind: 'frames', frames: thinkingFrames(FAKE_THREAD_ID, REASONING_TEXT, REPLY) } },
  agentProgress: {
    run: {
      kind: 'paced',
      batches: progressFrameBatches({ tools: PROGRESS_TOOLS, replyText: PROGRESS_REPLY }),
      gapMs: PROGRESS_GAP_MS,
    },
  },
  // Run 1 pauses on the removal; the run that answers it (`resume`) applies or declines it, as the
  // checkpointed graph does. The interrupt id is built from the browser's run id, and react-core
  // resumes on that same id. Any later turn is a plain reply.
  tripPlanConfirmation: {
    run: (runIndex, body) => {
      const answer = body.resume?.[0]
      const turn = { runId: body.runId, plan: TRIP_PLAN_TO_CONFIRM, change: TRIP_PLAN_REMOVAL }

      if (answer !== undefined) {
        const approved =
          answer.status === 'resolved' && (answer.payload as { approved?: unknown } | undefined)?.approved === true

        return {
          kind: 'frames',
          frames: tripPlanResumeFrames({
            ...turn,
            approved,
            replyText: approved ? TRIP_PLAN_REMOVED_REPLY : TRIP_PLAN_KEPT_REPLY,
          }),
        }
      }

      if (runIndex === 0) return { kind: 'frames', frames: tripPlanInterruptFrames(turn) }

      return { kind: 'reply', text: REPLY }
    },
  },
  // The Lambda with GEMINI_API_KEY set: `/info` advertises transcription and `/transcribe` answers.
  // Without the key (the default here, and dev today) the flag is false and no mic renders.
  voice: { transcribe: { kind: 'text', text: VOICE_TRANSCRIPT } },
  voiceRateLimited: { transcribe: { kind: 'http', status: 429, body: TRANSCRIPTION_RATE_LIMITED_BODY } },
  attachments: { run: { kind: 'reply', text: ATTACHMENT_REPLY } },
  // The first run draws the comparison, and a run that carries a button's `forwardedProps.a2uiAction`
  // is answered in text, as the graph does.
  a2uiComparison: {
    run: (runIndex, body) => {
      if (body.forwardedProps?.a2uiAction !== undefined) return { kind: 'reply', text: A2UI_ACTION_REPLY }

      return {
        kind: 'frames',
        frames: a2uiSurfaceFrames({
          surfaceId: A2UI_SURFACE_ID,
          components: A2UI_COMPARISON_COMPONENTS,
          text: A2UI_INTRO,
          toolCallId: `render-call-${runIndex + 1}`,
        }),
      }
    },
  },
  // Story-only: the Lambda keeps `openGenerativeUI` off (owner decision). This fake turns it on in
  // `/info`; the browser's `generateSandboxedUi` handler answers the call and react-core runs again.
  openGenerativeUi: {
    info: { overrides: { openGenerativeUIEnabled: true } },
    run: [
      {
        kind: 'frames',
        frames: openGenerativeUiFrames({
          css: '.stay{font-family:system-ui;padding:12px;border:1px solid #e5e7eb;border-radius:8px}',
          html: OPEN_GENUI_HTML,
        }),
      },
      { kind: 'reply', text: OPEN_GENUI_REPLY },
    ],
  },
} satisfies Record<string, RuntimeScenario>

export type ScenarioName = keyof typeof scenarios
