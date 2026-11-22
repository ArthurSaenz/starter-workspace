// `zod-v4` (npm:zod@4.5.4), not `zod`: the tool schemas need zod 4 (`z.toJSONSchema`), but
// @copilotkit/runtime pins zod 3 and wins the deploy's hoisting — see apps/ai/ARCHITECTURE.md
// "Packaging invariant".
import { z } from 'zod-v4'

/**
 * The MCP `CallToolResult` shape `handler` returns. No production caller since the MCP endpoint was
 * removed; only tests exercise it.
 */
export interface McpToolResult<O> {
  content: [{ type: 'text'; text: string }]
  structuredContent: O
  /** Set on a refusal; an MCP host then skips checking `structuredContent` against the output schema. */
  isError?: true
}

/**
 * What a tool answers when the arguments do not match its input schema. The model reads it as the
 * tool result, so it learns which argument was wrong and can call again; a thrown ZodError would
 * reach it only as an opaque failure.
 */
export interface InvalidToolArguments {
  error: string
}

/**
 * Who a graph tool call runs for: the run's `configurable` (`customerId`, `chatThreadId`, …), read by a
 * tool that must record its caller. Absent outside the graph (a test).
 */
export type ToolCallContext = Readonly<Record<string, unknown>>

/**
 * What a tool author writes. `execute` receives input already parsed by `inputSchema`,
 * so a tool body never sees the model's raw arguments.
 */
export interface ServerToolSpec<I, O> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<I>
  readonly outputSchema: z.ZodType<O>
  readonly execute: (input: I, context?: ToolCallContext) => Promise<O>
  /**
   * The result budget for this tool when the graph hands it to the model, in characters; the shared
   * `MAX_TOOL_RESULT_CHARS` when omitted. Only a tool whose one result stands in for several calls
   * should claim more.
   */
  readonly resultChars?: number
}

/**
 * What the graph adapter (`toLangChainServerTools`) binds through `execute`. `handler` is the MCP
 * wrapper, which no production code calls any more.
 *
 * The generics are erased so one array can hold every tool, and `execute` / `handler` take
 * `unknown` because that is what actually arrives — a JSON-Schema-bound LangChain tool hands
 * the model's arguments through unvalidated.
 */
export interface ServerToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType
  readonly outputSchema: z.ZodType
  /** The tool's output, or `InvalidToolArguments` when `input` does not match `inputSchema`. */
  readonly execute: (input: unknown, context?: ToolCallContext) => Promise<unknown>
  readonly handler: (input: unknown) => Promise<McpToolResult<Record<string, unknown>>>
  readonly resultChars?: number
}

/**
 * Erases the generics and derives the MCP wrapper from `execute`.
 *
 * The wrapper is mechanical — stringify the structured content — so deriving it here keeps
 * the wrapper on the same code path as `execute`. A hand-written `handler` per tool could drift from its
 * own `execute`, which is the one divergence nothing downstream could detect.
 */
const invalidArguments = (error: z.ZodError): InvalidToolArguments => {
  return { error: `invalid arguments: ${z.prettifyError(error)}` }
}

export const defineServerTool = <I, O>(spec: ServerToolSpec<I, O>): ServerToolDefinition => {
  const run = async (input: unknown, context?: ToolCallContext): Promise<O | InvalidToolArguments> => {
    const parsed = spec.inputSchema.safeParse(input)

    return parsed.success ? spec.execute(parsed.data, context) : invalidArguments(parsed.error)
  }

  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema as z.ZodType,
    outputSchema: spec.outputSchema as z.ZodType,
    execute: run,
    ...(spec.resultChars === undefined ? {} : { resultChars: spec.resultChars }),
    handler: async (input: unknown) => {
      const parsed = spec.inputSchema.safeParse(input)

      if (!parsed.success) {
        const refusal = invalidArguments(parsed.error)

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(refusal) }],
          structuredContent: { error: refusal.error },
          isError: true,
        }
      }

      const result = await spec.execute(parsed.data)

      // MCP requires `structuredContent` to be a JSON object, so a tool whose output schema
      // is a bare array or scalar cannot be served — refuse loudly here rather than emit a
      // registration an MCP client would reject with no indication of which tool was wrong.
      if (typeof result !== 'object' || result === null || Array.isArray(result)) {
        throw new TypeError(`server tool "${spec.name}" must return a JSON object for MCP structuredContent`)
      }

      const structuredContent = result as Record<string, unknown>

      return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent }
    },
  }
}
