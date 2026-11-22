import { EventType, Middleware } from '@ag-ui/client'
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
  ToolCallResultEvent,
  ToolCallStartEvent,
} from '@ag-ui/client'
import type { CopilotSseRuntimeOptions } from '@copilotkit/runtime/v2'
import { map, of } from 'rxjs'
import type { Observable } from 'rxjs'

export type A2uiRuntimeOptions = NonNullable<CopilotSseRuntimeOptions['a2ui']>
export type A2uiCatalogSchema = Extract<NonNullable<A2uiRuntimeOptions['schema']>, { catalogId: string }>

// The basic catalogs every A2UI renderer ships, v0.9 and 1.0. The v0.9 id stays: stored surfaces name it.
export const A2UI_BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'
export const A2UI_BASIC_CATALOG_ID_V1_0 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'

/**
 * The descriptions `@ag-ui/a2ui-middleware` (0.0.10 to 0.0.16) gives the two context entries it writes itself
 * (`A2UI_SCHEMA_CONTEXT_DESCRIPTION` and the `render_a2ui` usage guide). It drops every entry the
 * request carried under either description before adding its own, so on a run these are always
 * server text. Copied, not imported: the middleware is the runtime's dependency, not this package's.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  'A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.'
export const A2UI_TOOL_GUIDE_CONTEXT_DESCRIPTION =
  'A2UI render tool usage guide — how to call render_a2ui with valid arguments.'

// The middleware's `RENDER_A2UI_TOOL_GUIDELINES(RENDER_A2UI_TOOL_NAME)`, the value it writes under
// `A2UI_TOOL_GUIDE_CONTEXT_DESCRIPTION`; copied for the same reason. Byte-equal or the agent treats
// the entry as per-traveller and it leaves the fleet-wide cached block (`splitAgentContext`).
export const A2UI_TOOL_GUIDE_CONTEXT_VALUE = `## How to call render_a2ui

You MUST provide ALL required arguments when calling render_a2ui:

- **surfaceId** (string, required): Unique ID for the surface (e.g. "sales-dashboard").
- **components** (array, REQUIRED): A2UI v0.9 flat component array. NEVER omit this.
- **data** (object, optional): Initial data model for path-bound component values.

Note: the catalog id is set by the host, not by you. Do not include a catalogId argument.

### Component format (v0.9 flat)

Components are a flat array — children are referenced by ID, not nested:
- Every component has \`id\` (unique) and \`component\` (type name from the available catalog).
- The root component MUST have \`id: "root"\`.
- Properties go directly on the component object.
- Use \`children: ["id1", "id2"]\` for multiple children, \`child: "id"\` for a single child.

### Minimal example

\`\`\`json
{
  "surfaceId": "my-dashboard",
  "components": [
    { "id": "root", "component": "Column", "children": ["title", "row1"] },
    { "id": "title", "component": "Title", "text": "Overview" },
    { "id": "row1", "component": "Row", "children": ["m1", "m2"], "gap": 16 },
    { "id": "m1", "component": "Metric", "label": "Users", "value": "1,200" },
    { "id": "m2", "component": "Metric", "label": "Revenue", "value": "$50K" }
  ]
}
\`\`\`

### Key rules

1. NEVER call render_a2ui without the \`components\` array — the UI will be empty.
2. Root must be a layout component (Column, Row, Card) — not Text or Button.
3. Component IDs must be unique. A component must NOT reference itself as child.
4. Only use component names from the Available Components schema in context.
5. For data binding use \`{ "path": "/key" }\` (absolute) or \`{ "path": "key" }\` (relative inside templates).
6. For repeating content: \`children: { componentId: "card-id", path: "/items" }\` repeats per array item.
7. Button actions: \`"action": { "event": { "name": "action_name", "context": { ... } } }\` — event must be an object.
8. No placeholder images — only use real URLs or Icon components.`

// The same guide for a catalog that declares `protocolVersion: '1.0'` (`RENDER_A2UI_TOOL_GUIDELINES(name, '1.0')`,
// 0.0.16): the middleware writes this one instead, so it must be byte-equal for the same reason.
export const A2UI_TOOL_GUIDE_CONTEXT_VALUE_V1_0 = `## How to call render_a2ui

You MUST provide ALL required arguments when calling render_a2ui:

- **surfaceId** (string, required): Unique ID for the surface (e.g. "sales-dashboard").
- **components** (array, REQUIRED): A2UI 1.0 flat component array. NEVER omit this.
- **data** (object, optional): Initial data model for path-bound component values.

Note: the catalog id is set by the host, not by you. Do not include a catalogId argument.

### Component format (1.0 flat)

Components are a flat array — children are referenced by ID, not nested:
- Every component has \`id\` (unique) and \`component\` (type name from the available catalog).
- The root component MUST have \`id: "root"\`.
- Properties go directly on the component object.
- Use \`children: ["id1", "id2"]\` for multiple children, \`child: "id"\` for a single child.

### Minimal example

\`\`\`json
{
  "surfaceId": "my-dashboard",
  "components": [
    { "id": "root", "component": "Column", "children": ["title", "row1"] },
    { "id": "title", "component": "Title", "text": "Overview" },
    { "id": "row1", "component": "Row", "children": ["m1", "m2"], "gap": 16 },
    { "id": "m1", "component": "Metric", "label": "Users", "value": "1,200" },
    { "id": "m2", "component": "Metric", "label": "Revenue", "value": "$50K" }
  ]
}
\`\`\`

### Key rules

1. NEVER call render_a2ui without the \`components\` array — the UI will be empty.
2. Root must be a layout component (Column, Row, Card) — not Text or Button.
3. Component IDs must be unique. A component must NOT reference itself as child.
4. Only use component names from the Available Components schema in context.
5. For data binding use \`{ "@path": "/key" }\` (absolute) or \`{ "@path": "key" }\` (relative inside templates).
   A literal object with a "path" key is NOT a binding in 1.0. Call catalog functions with \`{ "@call": "functionName", "args": { ... } }\`.
6. For repeating content: \`children: { componentId: "card-id", path: "/items" }\` repeats per array item.
7. Button actions: \`"action": { "event": { "name": "action_name", "context": { ... } } }\` — event must be an object.
8. No placeholder images — only use real URLs or Icon components.`

// The middleware's `A2UIActivityType`: the activity a painted surface travels in.
export const A2UI_SURFACE_ACTIVITY = 'a2ui-surface'

// The middleware's `RENDER_A2UI_TOOL_NAME` and `A2UI_OPERATIONS_KEY`, copied for the same reason.
export const RENDER_A2UI_TOOL_NAME = 'render_a2ui'
export const A2UI_OPERATIONS_KEY = 'a2ui_operations'

// What the middleware answers a painted render call with; `cancelled` is its status for a call nobody answered.
export const A2UI_RENDERED_RESULT = JSON.stringify({ status: 'rendered' })
export const A2UI_CANCELLED_RESULT = JSON.stringify({ status: 'cancelled' })

// The `name` the middleware gives the user message it writes for a button press: the prefix and a
// base64url sha256 of the run id. It keeps that message out of every snapshot it forwards.
export const A2UI_ACTION_MESSAGE_NAME = /^a2ui_action_context_[\w-]{43}$/

/** The activity message a render call's surface is painted (and repainted) under. */
export const a2uiSurfaceActivityId = (toolCallId: string): string => {
  return `${A2UI_SURFACE_ACTIVITY}-${toolCallId}`
}

type AgentMiddleware = Parameters<AbstractAgent['use']>[number]

/** The two settings that name render tools; the runtime hands its `a2ui` options to the middleware as its config. */
export interface A2uiRenderToolConfig {
  a2uiToolNames?: readonly string[]
  injectA2UITool?: boolean | string
}

interface A2uiMiddlewareShape {
  config?: A2uiRenderToolConfig
  injectSchemaContext?: unknown
  processStream?: unknown
}

// The runtime builds the middleware itself (and its class name is minified), so it is known by shape.
const isA2uiMiddleware = (middleware: AgentMiddleware): boolean => {
  const shape = middleware as A2uiMiddlewareShape

  return typeof shape.injectSchemaContext === 'function' && typeof shape.processStream === 'function'
}

/** The tools whose calls the middleware paints and answers itself (its `getA2UIToolNames`). */
export const a2uiRenderToolNames = ({ a2uiToolNames, injectA2UITool }: A2uiRenderToolConfig): ReadonlySet<string> => {
  const names = new Set(a2uiToolNames ?? [RENDER_A2UI_TOOL_NAME])

  if (typeof injectA2UITool === 'string' && injectA2UITool.length > 0) names.add(injectA2UITool)
  else if (injectA2UITool === true) names.add(RENDER_A2UI_TOOL_NAME)

  return names
}

const renderToolNamesOf = (middleware: AgentMiddleware): ReadonlySet<string> => {
  return a2uiRenderToolNames((middleware as A2uiMiddlewareShape).config ?? {})
}

const withoutOperationsKey = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !(A2UI_OPERATIONS_KEY in value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => {
      return key !== A2UI_OPERATIONS_KEY
    }),
  )
}

/**
 * A tool result with the A2UI operations it carries removed. The middleware paints any tool result
 * whose JSON (or JSON inside a JSON string) holds `a2ui_operations`, so a tool that echoes outside
 * text — a web page, a remembered note — could otherwise draw a surface the model never rendered.
 */
export const withoutA2uiOperations = (content: string): string => {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    return content
  }

  if (typeof parsed === 'string') {
    const inner = withoutA2uiOperations(parsed)

    return inner === parsed ? content : JSON.stringify(inner)
  }

  const stripped = withoutOperationsKey(parsed)

  return stripped === parsed ? content : JSON.stringify(stripped)
}

const isResume = (input: RunAgentInput): boolean => {
  const command = (input.forwardedProps as { command?: { resume?: unknown } } | undefined)?.command

  return (input.resume ?? []).length > 0 || command?.resume !== undefined
}

const isRenderedResult = (content: unknown): boolean => {
  if (typeof content !== 'string') return false

  try {
    return (JSON.parse(content) as { status?: unknown } | null)?.status === 'rendered'
  } catch {
    return false
  }
}

/**
 * The run has nothing left to say: its history ends on a turn that only drew surfaces, each of them
 * painted. That is the run `@ag-ui/a2ui-middleware` 0.0.16 starts by itself once it has answered a
 * render call (its "Automatic tool completion"); a model hop there would write a second answer under
 * a surface that is the answer. A failed render, a resume, or anything the traveller said after the
 * surface — a follow-up, a button press — is not this run.
 */
export const endsOnPaintedSurfaces = (input: RunAgentInput, renderToolNames: ReadonlySet<string>): boolean => {
  if (isResume(input)) return false

  // Neither reaches the model, so neither is something said after the surface.
  const spoken = input.messages.filter((message) => {
    return message.role !== 'activity' && message.role !== 'reasoning'
  })

  const turnIndex = spoken
    .map((message) => {
      return message.role === 'assistant'
    })
    .lastIndexOf(true)

  const turn = spoken[turnIndex]
  const calls = turn?.role === 'assistant' ? (turn.toolCalls ?? []) : []
  const tail: Message[] = spoken.slice(turnIndex + 1)

  const isEveryCallARender =
    calls.length > 0 &&
    calls.every((call) => {
      return renderToolNames.has(call.function.name)
    })

  if (!isEveryCallARender || tail.length === 0) return false

  const pending = new Set(
    calls.map((call) => {
      return call.id
    }),
  )

  const isEveryResultAPaint = tail.every((message) => {
    return message.role === 'tool' && isRenderedResult(message.content) && pending.delete(message.toolCallId)
  })

  return isEveryResultAPaint && pending.size === 0
}

/**
 * Sits between the agent and the A2UI middleware: only a render tool's result may carry operations,
 * and a run that ends on painted surfaces never reaches the agent.
 */
export class A2uiToolResultGuard extends Middleware {
  constructor(private readonly renderToolNames: ReadonlySet<string>) {
    super()
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    if (endsOnPaintedSurfaces(input, this.renderToolNames)) {
      const { threadId, runId } = input

      // The middleware holds a run's RUN_FINISHED until its stream completes and forwards nothing
      // without one, so the pair is the smallest stream it can end the traveller's run on.
      return of(
        { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent,
      )
    }

    const toolNames = new Map<string, string>()

    return this.runNext(input, next).pipe(
      map((event) => {
        if (event.type === EventType.TOOL_CALL_START) {
          const { toolCallId, toolCallName } = event as ToolCallStartEvent

          toolNames.set(toolCallId, toolCallName)
        }

        if (event.type !== EventType.TOOL_CALL_RESULT) return event

        const result = event as ToolCallResultEvent

        if (this.renderToolNames.has(toolNames.get(result.toolCallId) ?? '')) return event
        // AG-UI 1.0 allows multimodal parts here; the A2UI middleware only `JSON.parse`s a string, so parts never paint.
        if (typeof result.content !== 'string') return event

        const content = withoutA2uiOperations(result.content)

        return content === result.content ? event : ({ ...result, content } as BaseEvent)
      }),
    )
  }
}

/** The middlewares with a result guard placed inside each A2UI middleware (nearer the agent). */
export const guardA2uiMiddleware = (middlewares: readonly AgentMiddleware[]): AgentMiddleware[] => {
  return middlewares.flatMap((middleware) => {
    return isA2uiMiddleware(middleware)
      ? [middleware, new A2uiToolResultGuard(renderToolNamesOf(middleware))]
      : [middleware]
  })
}
