import { EventType } from '@ag-ui/client'
import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
import { firstValueFrom, toArray } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import {
  InProcessAgent,
  RUN_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE,
  serviceUnavailableMessage,
} from '../copilotkit/inProcessAgent.js'
import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'
import { runWithRequestContext } from '../copilotkit/requestContext.js'
import { traceRunIdOf } from '../copilotkit/traceRunId.js'

const makeGraph = (events: unknown[]): StreamableGraph => {
  return {
    streamEvents: () => {
      return (async function* () {
        for (const event of events) {
          yield event as never
        }
      })()
    },
  }
}

// A model call still waiting on the provider: `streamEvents` never yields. `signal()` reads the
// AbortSignal the agent passed in.
const NEVER_YIELDS: AsyncIterable<never> = {
  [Symbol.asyncIterator]: () => {
    return {
      next: () => {
        return new Promise<never>(() => {
          return undefined
        })
      },
    }
  },
}

const makePendingGraph = (): { graph: StreamableGraph; signal: () => AbortSignal | undefined } => {
  let receivedSignal: AbortSignal | undefined

  return {
    graph: {
      streamEvents: (_input, options) => {
        receivedSignal = options.signal

        return NEVER_YIELDS
      },
    },
    signal: () => {
      return receivedSignal
    },
  }
}

const baseInput = (overrides: Partial<RunAgentInput> = {}): RunAgentInput => {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    state: {},
    messages: [{ id: 'u1', role: 'user', content: 'hi' }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  } as RunAgentInput
}

const runToEvents = async (agent: InProcessAgent, input: RunAgentInput): Promise<BaseEvent[]> => {
  return firstValueFrom(agent.run(input).pipe(toArray()))
}

describe('inProcessAgent', () => {
  it('emits RUN_STARTED, streamed text, then RUN_FINISHED', async () => {
    const graph = makeGraph([
      { event: 'on_chat_model_stream', run_id: 'r', data: { chunk: { id: 'm1', content: 'Hi ' } } },
      { event: 'on_chat_model_stream', run_id: 'r', data: { chunk: { id: 'm1', content: 'Bob' } } },
      { event: 'on_chat_model_end', data: {} },
    ])

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    const events = await runToEvents(agent, baseInput())

    const types = events.map((event) => {
      return event.type
    })

    expect(types[0]).toBe(EventType.RUN_STARTED)
    expect(types).toContain(EventType.TEXT_MESSAGE_START)
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT)
    expect(types).toContain(EventType.TEXT_MESSAGE_END)
    expect(types.at(-1)).toBe(EventType.RUN_FINISHED)

    const text = events
      .filter((event) => {
        return event.type === EventType.TEXT_MESSAGE_CONTENT
      })
      .map((event) => {
        return (event as unknown as { delta: string }).delta
      })
      .join('')

    expect(text).toBe('Hi Bob')
  })

  it('streams a frontend tool call WITHOUT a tool result (the FE executes it)', async () => {
    const graph = makeGraph([
      {
        event: 'on_chat_model_stream',
        data: {
          chunk: {
            id: 'm1',
            tool_call_chunks: [{ id: 'call-1', name: 'change_background', args: '{"background":"red"}', index: 0 }],
          },
        },
      },
      { event: 'on_chat_model_end', data: {} },
    ])

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    const events = await runToEvents(agent, baseInput())

    const types = events.map((event) => {
      return event.type
    })

    expect(types).toContain(EventType.TOOL_CALL_START)
    expect(types).toContain(EventType.TOOL_CALL_ARGS)
    expect(types).toContain(EventType.TOOL_CALL_END)
    // Critical: no backend tool result — the frontend runs the handler and
    // returns the result on the next turn.
    expect(types).not.toContain(EventType.TOOL_CALL_RESULT)
  })

  it('keeps one toolCallId when only the first chunk carries the id (OpenAI/DeepSeek-style)', async () => {
    const graph = makeGraph([
      {
        event: 'on_chat_model_stream',
        data: {
          chunk: { id: 'm1', tool_call_chunks: [{ id: 'call-1', name: 'change_background', args: '', index: 0 }] },
        },
      },
      {
        event: 'on_chat_model_stream',
        data: { chunk: { id: 'm1', tool_call_chunks: [{ args: '{"background":', index: 0 }] } },
      },
      {
        event: 'on_chat_model_stream',
        data: { chunk: { id: 'm1', tool_call_chunks: [{ args: '"red"}', index: 0 }] } },
      },
      {
        event: 'on_chat_model_end',
        run_id: 'r1',
        data: { output: { tool_calls: [{ id: 'call-1', name: 'change_background', args: { background: 'red' } }] } },
      },
    ])

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    const events = await runToEvents(agent, baseInput())

    const toolEvents = events.filter((event) => {
      return [EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END].includes(event.type)
    }) as unknown as Array<{ type: EventType; toolCallId: string; delta?: string }>

    expect(
      toolEvents.map((event) => {
        return event.type
      }),
    ).toEqual([EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END])
    expect(
      new Set(
        toolEvents.map((event) => {
          return event.toolCallId
        }),
      ),
    ).toEqual(new Set(['call-1']))
    expect(
      toolEvents
        .map((event) => {
          return event.delta ?? ''
        })
        .join(''),
    ).toBe('{"background":"red"}')
  })

  it('emits a complete tool call delivered only on on_chat_model_end (Gemini-style)', async () => {
    const graph = makeGraph([
      {
        event: 'on_chat_model_end',
        run_id: 'r1',
        data: { output: { tool_calls: [{ id: 'c1', name: 'change_background', args: { background: 'red' } }] } },
      },
    ])

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    const events = await runToEvents(agent, baseInput())

    const types = events.map((event) => {
      return event.type
    })

    expect(types).toContain(EventType.TOOL_CALL_START)
    expect(types).toContain(EventType.TOOL_CALL_ARGS)
    expect(types).toContain(EventType.TOOL_CALL_END)
    expect(types).not.toContain(EventType.TOOL_CALL_RESULT)

    const args = events.find((event) => {
      return event.type === EventType.TOOL_CALL_ARGS
    }) as unknown as { delta: string } | undefined

    expect(args?.delta).toContain('red')
  })

  it('aborts the graph signal on unsubscribe so the provider call stops', async () => {
    const { graph, signal } = makePendingGraph()
    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    const subscription = agent.run(baseInput()).subscribe()

    await new Promise((resolve) => {
      return setTimeout(resolve, 0)
    })
    expect(signal()?.aborted).toBe(false)

    subscription.unsubscribe()

    expect(signal()?.aborted).toBe(true)
  })

  it('abortRun() (the runner stop path) aborts the graph signal of the active run', async () => {
    const { graph, signal } = makePendingGraph()
    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    agent.run(baseInput()).subscribe()

    await new Promise((resolve) => {
      return setTimeout(resolve, 0)
    })
    expect(signal()?.aborted).toBe(false)

    agent.abortRun()

    expect(signal()?.aborted).toBe(true)
  })

  it('surfaces graph errors through the observable as the generic run error (raw text stays in the logs)', async () => {
    const graph: StreamableGraph = {
      streamEvents: () => {
        return Promise.reject(new Error('boom'))
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    await expect(runToEvents(agent, baseInput())).rejects.toThrow(RUN_ERROR_MESSAGE)
  })

  it('ends a run the provider refused for billing with a coded SERVICE_UNAVAILABLE and one metric line', async () => {
    const credit = new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
    )

    const graph: StreamableGraph = {
      streamEvents: () => {
        return Promise.reject(new Error('graph node failed', { cause: credit }))
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8, appName: 'NomaDream' })
    const written: string[] = []

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))

      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))

      return true
    })

    const events = await runToEvents(agent, baseInput())

    vi.restoreAllMocks()

    expect(events.at(-1)).toEqual({
      type: EventType.RUN_ERROR,
      message: "NomaDream's assistant is temporarily unavailable. Please try again later.",
      code: SERVICE_UNAVAILABLE,
    })
    expect(serviceUnavailableMessage('NomaDream')).toBe(
      "NomaDream's assistant is temporarily unavailable. Please try again later.",
    )
    expect(
      written.filter((line) => {
        return line.includes('"metric":"provider_credit_exhausted"')
      }),
    ).toHaveLength(1)
  })

  it('names no product in the outage notice when the host names none', async () => {
    const credit = new Error('Your credit balance is too low to access the Anthropic API.')

    const graph: StreamableGraph = {
      streamEvents: () => {
        return Promise.reject(new Error('graph node failed', { cause: credit }))
      },
    }

    vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      return true
    })

    const events = await runToEvents(
      new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 }).clone(),
      baseInput(),
    )

    vi.restoreAllMocks()

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      message: 'The assistant is temporarily unavailable. Please try again later.',
    })
  })

  // Phase 0.3 cost ceiling: a runaway tool loop must terminate at the configured
  // step budget. This only proves the value reaches `streamEvents` — the graph
  // itself has no loop yet (START → agent → END), so there is nothing to run away.
  it('forwards recursionLimit to every streamEvents call', async () => {
    const receivedOptions: Array<{ recursionLimit?: number }> = []

    const graph: StreamableGraph = {
      streamEvents: (_input, options) => {
        receivedOptions.push(options)

        return (async function* () {
          yield { event: 'on_chat_model_end', data: {} } as never
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    await runToEvents(agent, baseInput())

    expect(receivedOptions).toHaveLength(1)
    expect(receivedOptions[0]?.recursionLimit).toBe(8)
  })

  it('preserves recursionLimit through clone() (CopilotSseRuntime clones per request)', async () => {
    const receivedOptions: Array<{ recursionLimit?: number }> = []

    const graph: StreamableGraph = {
      streamEvents: (_input, options) => {
        receivedOptions.push(options)

        return (async function* () {
          yield { event: 'on_chat_model_end', data: {} } as never
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })
    const cloned = agent.clone()

    await runToEvents(cloned, baseInput())

    expect(receivedOptions[0]?.recursionLimit).toBe(8)
  })

  // Provider content shapes: DeepSeek streams plain strings, Gemini/Anthropic-style models a
  // block list where only `text` blocks carry visible output.
  describe('text delta extraction', () => {
    const deltasOf = (events: BaseEvent[]): string[] => {
      return events
        .filter((event) => {
          return event.type === EventType.TEXT_MESSAGE_CONTENT
        })
        .map((event) => {
          return (event as unknown as { delta: string }).delta
        })
    }

    it('joins string and text blocks of a block-list chunk and skips non-text blocks', async () => {
      const graph = makeGraph([
        {
          event: 'on_chat_model_stream',
          run_id: 'r',
          data: {
            chunk: {
              id: 'm1',
              content: ['Hel', { type: 'text', text: 'lo' }, { type: 'image_url', image_url: 'x' }, { type: 'text' }],
            },
          },
        },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = await runToEvents(agent, baseInput())

      expect(deltasOf(events)).toEqual(['Hello'])
    })

    it('emits no text events for a chunk whose content is neither string nor array', async () => {
      const graph = makeGraph([
        { event: 'on_chat_model_stream', run_id: 'r', data: { chunk: { id: 'm1', content: { weird: true } } } },
        { event: 'on_chat_model_stream', run_id: 'r', data: {} },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = await runToEvents(agent, baseInput())

      const types = events.map((event) => {
        return event.type
      })

      expect(types).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED])
    })

    it('falls back to run_id as the message id when the chunk has none', async () => {
      const graph = makeGraph([
        { event: 'on_chat_model_stream', run_id: 'run-x', data: { chunk: { content: 'hi' } } },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = await runToEvents(agent, baseInput())

      const start = events.find((event) => {
        return event.type === EventType.TEXT_MESSAGE_START
      }) as unknown as { messageId: string }

      expect(start.messageId).toBe('run-x')
    })
  })

  describe('on_chat_model_end fallback', () => {
    interface ToolEvent {
      type: string
      toolCallId: string
      toolCallName?: string
      delta?: string
    }

    const toolEvents = (events: BaseEvent[]): ToolEvent[] => {
      return events
        .filter((event) => {
          return event.type === EventType.TOOL_CALL_START || event.type === EventType.TOOL_CALL_ARGS
        })
        .map((event) => {
          return event as unknown as ToolEvent
        })
    }

    it('synthesises a toolCallId from run_id + name when the provider sends none', async () => {
      const graph = makeGraph([
        {
          event: 'on_chat_model_end',
          run_id: 'run-9',
          data: { output: { tool_calls: [{ name: 'change_background', args: { background: 'red' } }] } },
        },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const [start, args] = toolEvents(await runToEvents(agent, baseInput()))

      expect(start).toMatchObject({ toolCallId: 'run-9-change_background', toolCallName: 'change_background' })
      expect(args).toMatchObject({ toolCallId: 'run-9-change_background', delta: '{"background":"red"}' })
    })

    it('passes string args through and serialises missing args as {}', async () => {
      const graph = makeGraph([
        {
          event: 'on_chat_model_end',
          run_id: 'r',
          data: {
            output: {
              tool_calls: [{ id: 'c1', name: 'a', args: '{"raw":1}' }, { id: 'c2', name: 'b' }, { id: 'c3' }],
            },
          },
        },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = toolEvents(await runToEvents(agent, baseInput()))

      const argsByCall = Object.fromEntries(
        events
          .filter((event) => {
            return event.type === EventType.TOOL_CALL_ARGS
          })
          .map((event) => {
            return [event.toolCallId, event.delta]
          }),
      )

      expect(argsByCall).toEqual({ c1: '{"raw":1}', c2: '{}' })
      expect(
        events.some((event) => {
          return event.toolCallId === 'c3'
        }),
      ).toBe(false)
    })

    it('ignores an end event whose output is not an object or has no tool_calls', async () => {
      const graph = makeGraph([
        { event: 'on_chat_model_end', data: { output: 'plain string' } },
        { event: 'on_chat_model_end', data: { output: { content: 'no tools here' } } },
        { event: 'unknown_event', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = await runToEvents(agent, baseInput())

      const types = events.map((event) => {
        return event.type
      })

      expect(types).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED])
    })
  })

  describe('on_tool_end (server-side tool results)', () => {
    const resultOf = (events: BaseEvent[]): Array<{ toolCallId: string; content: string; messageId: string }> => {
      return events
        .filter((event) => {
          return event.type === EventType.TOOL_CALL_RESULT
        })
        .map((event) => {
          return event as unknown as { toolCallId: string; content: string; messageId: string }
        })
    }

    it('emits TOOL_CALL_RESULT keyed by tool_call_id, serialising each output shape', async () => {
      interface Circular {
        tool_call_id: string
        self?: Circular
      }

      const circular: Circular = { tool_call_id: 'c4' }

      circular.self = circular

      const graph = makeGraph([
        { event: 'on_tool_end', data: { output: { tool_call_id: 'c1', content: 'text result' } } },
        { event: 'on_tool_end', data: { output: { tool_call_id: 'c2', payload: { ok: true } } } },
        { event: 'on_tool_end', data: { output: { tool_call_id: 'c3', content: { nested: 1 } } } },
        { event: 'on_tool_end', data: { output: circular } },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const results = resultOf(await runToEvents(agent, baseInput()))

      expect(
        results.map((result) => {
          return [result.toolCallId, result.content]
        }),
      ).toEqual([
        ['c1', 'text result'],
        ['c2', '{"tool_call_id":"c2","payload":{"ok":true}}'],
        ['c3', '{"tool_call_id":"c3","content":{"nested":1}}'],
        ['c4', '[object Object]'],
      ])
      // AG-UI requires messageId === toolCallId on a result.
      expect(
        results.every((result) => {
          return result.messageId === result.toolCallId
        }),
      ).toBe(true)
    })

    it('skips tool outputs that cannot be correlated to a call', async () => {
      const graph = makeGraph([
        { event: 'on_tool_end', data: { output: { content: 'orphan' } } },
        { event: 'on_tool_end', data: { output: { tool_call_id: null, content: 'null id' } } },
        { event: 'on_tool_end', data: { output: 'string output' } },
        { event: 'on_tool_end', data: {} },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      expect(resultOf(await runToEvents(agent, baseInput()))).toEqual([])
    })
  })

  it('closes open text and tool streams before surfacing a mid-stream graph error', async () => {
    const graph: StreamableGraph = {
      streamEvents: () => {
        return (async function* () {
          yield { event: 'on_chat_model_stream', run_id: 'r', data: { chunk: { id: 'm1', content: 'par' } } } as never
          yield {
            event: 'on_chat_model_stream',
            data: { chunk: { id: 'm1', tool_call_chunks: [{ id: 'c1', name: 't', args: '{', index: 0 }] } },
          } as never
          throw new Error('provider dropped the connection')
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })
    const seen: BaseEvent[] = []

    await expect(
      new Promise<void>((resolve, reject) => {
        agent.run(baseInput()).subscribe({
          next: (event) => {
            return seen.push(event)
          },
          error: reject,
          complete: resolve,
        })
      }),
    ).rejects.toThrow(RUN_ERROR_MESSAGE)

    const types = seen.map((event) => {
      return event.type
    })

    expect(types).toContain(EventType.TEXT_MESSAGE_END)
    expect(types).toContain(EventType.TOOL_CALL_END)
    expect(types).not.toContain(EventType.RUN_FINISHED)
  })

  it('forwards frontend tools, context and thread ids through graph configurable', async () => {
    const receivedOptions: Array<{ configurable?: Record<string, unknown> }> = []

    const graph: StreamableGraph = {
      streamEvents: (_input, options) => {
        receivedOptions.push(options)

        return (async function* () {
          yield { event: 'on_chat_model_end', data: {} } as never
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })
    const tools = [{ name: 'change_background', description: 'd', parameters: { type: 'object' } }]
    const context = [{ description: 'Name of the user', value: 'Bob' }]

    await runToEvents(agent, baseInput({ tools, context } as Partial<RunAgentInput>))

    expect(receivedOptions[0]?.configurable).toEqual({
      thread_id: 'thread-1',
      run_id: 'run-1',
      chatThreadId: 'thread-1',
      frontendTools: tools,
      context,
    })
  })

  it('labels the trace root with the run kind and the chat thread, not the per-turn checkpoint thread', async () => {
    const receivedOptions: Array<{ runName?: string; tags?: string[]; metadata?: Record<string, unknown> }> = []

    const graph: StreamableGraph = {
      streamEvents: (_input, options) => {
        receivedOptions.push(options)

        return (async function* () {
          yield { event: 'on_chat_model_end', data: {} } as never
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    await runToEvents(agent, baseInput({ threadId: 'cust-1:chat-9' }))
    await runToEvents(agent, baseInput({ forwardedProps: { toolChoice: 'required' } }))

    expect(receivedOptions[0]).toMatchObject({
      runName: 'travelAiAgent:chat',
      tags: ['chat'],
      metadata: { thread_id: 'cust-1:chat-9' },
    })
    expect(receivedOptions[1]).toMatchObject({ runName: 'travelAiAgent:suggestion', tags: ['suggestion'] })
  })

  // FR-28: the graph attributes a server-tool invocation to the traveller the Lambda
  // verified. The identity cannot ride on `RunAgentInput` (the browser writes that), and the
  // agent is built once at cold start, so it travels through the request context instead.
  it('forwards the verified identity from the request context into graph configurable', async () => {
    const receivedOptions: Array<{ configurable?: Record<string, unknown> }> = []

    const graph: StreamableGraph = {
      streamEvents: (_input, options) => {
        receivedOptions.push(options)

        return (async function* () {
          yield { event: 'on_chat_model_end', data: {} } as never
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

    await runWithRequestContext({ customerId: 'cust-42', awsRequestId: 'req-7' }, async () => {
      await runToEvents(agent, baseInput())
    })

    expect(receivedOptions[0]?.configurable).toMatchObject({ customerId: 'cust-42', awsRequestId: 'req-7' })
  })

  // The runner keeps the same id beside the answer, so a vote on it reaches this trace.
  it('names the trace root after the owner and the turn, and only in a served request', async () => {
    const receivedOptions: Array<{ runId?: string }> = []

    const graph: StreamableGraph = {
      streamEvents: (_input, options) => {
        receivedOptions.push(options)

        return (async function* () {
          yield { event: 'on_chat_model_end', data: {} } as never
        })()
      },
    }

    const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })
    const input = baseInput()

    await runToEvents(agent, input)
    await runWithRequestContext({ customerId: 'cust-42', awsRequestId: 'req-7' }, async () => {
      await runToEvents(agent, input)
    })

    expect(receivedOptions[0]).not.toHaveProperty('runId')
    expect(receivedOptions[1]?.runId).toBe(traceRunIdOf('cust-42', input.threadId, input.runId))
  })

  describe('reasoning', () => {
    const typesOf = (events: BaseEvent[]): EventType[] => {
      return events.map((event) => {
        return event.type
      })
    }

    const reasoningDeltas = (events: BaseEvent[]): string[] => {
      return events
        .filter((event) => {
          return event.type === EventType.REASONING_MESSAGE_CONTENT
        })
        .map((event) => {
          return (event as unknown as { delta: string }).delta
        })
    }

    const reasoningChunk = (text: string) => {
      return {
        event: 'on_chat_model_stream',
        data: { chunk: { id: 'm1', additional_kwargs: { reasoning_content: text } } },
      }
    }

    it('streams DeepSeek reasoning_content as a reasoning message closed before the reply starts', async () => {
      const graph = makeGraph([
        reasoningChunk('Think '),
        reasoningChunk('hard'),
        { event: 'on_chat_model_stream', data: { chunk: { id: 'm1', content: 'Answer' } } },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = await runToEvents(agent, baseInput())

      expect(typesOf(events)).toEqual([
        EventType.RUN_STARTED,
        EventType.REASONING_START,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.REASONING_END,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ])
      expect(reasoningDeltas(events)).toEqual(['Think ', 'hard'])
      // Its own id: the client keys messages by id, and the reply must stay a separate message.
      expect(events[1]).toMatchObject({ messageId: 'm1-reasoning' })
      expect(events[2]).toMatchObject({ messageId: 'm1-reasoning', role: 'reasoning' })
    })

    it('reads Gemini thinking blocks and LangChain reasoning blocks, never as reply text', async () => {
      const graph = makeGraph([
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              id: 'm1',
              content: [
                { type: 'thinking', thinking: 'Gemini thought. ' },
                { type: 'reasoning', reasoning: 'Standard block.' },
              ],
            },
          },
        },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const events = await runToEvents(agent, baseInput())

      expect(reasoningDeltas(events)).toEqual(['Gemini thought. Standard block.'])
      expect(typesOf(events)).not.toContain(EventType.TEXT_MESSAGE_START)
      expect(typesOf(events)).toContain(EventType.REASONING_END)
    })

    it('closes the reasoning before a tool call opens', async () => {
      const graph = makeGraph([
        reasoningChunk('Need hotels'),
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: { id: 'm1', tool_call_chunks: [{ id: 'call-1', name: 'hotels_search', args: '{}', index: 0 }] },
          },
        },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      const types = typesOf(await runToEvents(agent, baseInput()))

      expect(types.indexOf(EventType.REASONING_END)).toBeLessThan(types.indexOf(EventType.TOOL_CALL_START))
    })

    it('closes an open reasoning message before surfacing a graph error', async () => {
      const graph: StreamableGraph = {
        streamEvents: () => {
          return (async function* () {
            yield reasoningChunk('Hmm') as never
            throw new Error('provider quota exceeded')
          })()
        },
      }

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })
      const seen: BaseEvent[] = []

      await new Promise<void>((resolve) => {
        agent.run(baseInput()).subscribe({
          next: (event) => {
            seen.push(event)
          },
          error: () => {
            resolve()
          },
        })
      })

      expect(typesOf(seen).slice(-2)).toEqual([EventType.REASONING_MESSAGE_END, EventType.REASONING_END])
    })
  })

  describe('run progress', () => {
    const PROGRESS = {
      activityType: 'agent-progress',
      maxSteps: 5,
      steps: { agent: 'thinking', serverTools: 'researching' },
    } as const

    const nodeStart = (node: string) => {
      return { event: 'on_chain_start', name: node, metadata: { langgraph_node: node } }
    }

    interface ActivityEvent {
      type: EventType
      messageId: string
      content?: unknown
      patch?: unknown
    }

    const activityOf = (events: BaseEvent[]): ActivityEvent[] => {
      return events.filter((event) => {
        return event.type === EventType.ACTIVITY_SNAPSHOT || event.type === EventType.ACTIVITY_DELTA
      }) as unknown as ActivityEvent[]
    }

    const collectUntilError = async (agent: InProcessAgent): Promise<BaseEvent[]> => {
      const seen: BaseEvent[] = []

      await new Promise<void>((resolve) => {
        agent.run(baseInput()).subscribe({
          next: (event) => {
            seen.push(event)
          },
          error: () => {
            resolve()
          },
        })
      })

      return seen
    }

    it('reports each graph step, the tools it ran, the answer and the end as one activity message', async () => {
      const graph = makeGraph([
        nodeStart('agent'),
        // A runnable inside the node shares its metadata but is not a step.
        { event: 'on_chain_start', name: 'RunnableSequence', metadata: { langgraph_node: 'agent' } },
        nodeStart('serverTools'),
        { event: 'on_tool_start', name: 'hotels_search' },
        { event: 'on_tool_start', name: 'hotels_search' },
        { event: 'on_tool_start', name: 'hotel_detail' },
        nodeStart('agent'),
        { event: 'on_chat_model_stream', data: { chunk: { id: 'm1', content: 'Here' } } },
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8, progress: PROGRESS })

      const activity = activityOf(await runToEvents(agent, baseInput()))

      expect(
        new Set(
          activity.map((event) => {
            return event.messageId
          }),
        ),
      ).toEqual(new Set(['progress-run-1']))
      expect(activity[0]).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
        content: { phase: 'thinking', step: 1, maxSteps: 5, tools: [] },
      })
      expect(
        activity.slice(1).map((event) => {
          return event.patch
        }),
      ).toEqual([
        [
          { op: 'replace', path: '/phase', value: 'researching' },
          { op: 'replace', path: '/step', value: 2 },
        ],
        [{ op: 'replace', path: '/tools', value: ['hotels_search'] }],
        [{ op: 'replace', path: '/tools', value: ['hotels_search', 'hotel_detail'] }],
        [
          { op: 'replace', path: '/phase', value: 'thinking' },
          { op: 'replace', path: '/step', value: 3 },
        ],
        [{ op: 'replace', path: '/phase', value: 'answering' }],
        [{ op: 'replace', path: '/phase', value: 'done' }],
      ])
    })

    it('ends the progress as done when the run fails', async () => {
      const graph: StreamableGraph = {
        streamEvents: () => {
          return (async function* () {
            yield nodeStart('agent') as never
            throw new Error('boom')
          })()
        },
      }

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8, progress: PROGRESS })

      expect(activityOf(await collectUntilError(agent)).at(-1)?.patch).toEqual([
        { op: 'replace', path: '/phase', value: 'done' },
      ])
    })

    it('emits no activity without a progress config', async () => {
      const graph = makeGraph([nodeStart('agent'), { event: 'on_chat_model_end', data: {} }])
      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      expect(activityOf(await runToEvents(agent, baseInput()))).toEqual([])
    })
  })

  describe('capabilities', () => {
    it('serves the configured capabilities and keeps them, and the progress config, through clone()', async () => {
      const capabilities = { tools: { supported: true }, reasoning: { supported: false } }
      const graph = makeGraph([{ event: 'on_chain_start', name: 'agent', metadata: { langgraph_node: 'agent' } }])

      const agent = new InProcessAgent({
        graph,
        graphId: 'travelAiAgent',
        recursionLimit: 8,
        capabilities,
        progress: { activityType: 'agent-progress', maxSteps: 5, steps: { agent: 'thinking' } },
      })

      const clone = agent.clone()

      expect(await agent.getCapabilities()).toEqual(capabilities)
      expect(await clone.getCapabilities()).toEqual(capabilities)
      expect(
        (await runToEvents(clone, baseInput())).some((event) => {
          return event.type === EventType.ACTIVITY_SNAPSHOT
        }),
      ).toBe(true)
    })

    it('claims nothing when no capabilities are configured', async () => {
      const agent = new InProcessAgent({ graph: makeGraph([]), graphId: 'travelAiAgent', recursionLimit: 8 })

      expect(await agent.getCapabilities()).toEqual({})
    })
  })

  describe('shared state', () => {
    // A stand-in for the trip plan: one channel `plan`, a predictor that reads `"city"` out of
    // whatever part of the `set_city` arguments has arrived.
    const SHARED = {
      keys: ['plan'],
      fromInput: (state: unknown) => {
        const plan = (state as { plan?: { city?: unknown } } | undefined)?.plan

        return { plan: { city: typeof plan?.city === 'string' ? plan.city : null } }
      },
      predict: (toolName: string, partialArgs: string) => {
        const city = /"city":"([^"]+)"/u.exec(partialArgs)?.[1]

        return toolName === 'set_city' && city ? { plan: { city, pending: true } } : undefined
      },
    }

    const nodeEnd = (node: string, output: Record<string, unknown>) => {
      return { event: 'on_chain_end', name: node, metadata: { langgraph_node: node }, data: { output } }
    }

    const stateEventsOf = (events: BaseEvent[]) => {
      return events.filter((event) => {
        return event.type === EventType.STATE_SNAPSHOT || event.type === EventType.STATE_DELTA
      }) as unknown as Array<{ type: EventType; snapshot?: unknown; delta?: unknown }>
    }

    it('takes the browser state into the graph input and publishes the validated baseline first', async () => {
      const inputs: unknown[] = []

      const graph: StreamableGraph = {
        streamEvents: (graphInput) => {
          inputs.push(graphInput)

          return (async function* () {
            yield { event: 'on_chat_model_end', data: {} } as never
          })()
        },
      }

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8, sharedState: SHARED })

      const events = await runToEvents(agent, baseInput({ state: { plan: { city: 7 }, theme: 'dark' } }))

      expect(inputs[0]).toMatchObject({ plan: { city: null } })
      expect(events[1]).toEqual({ type: EventType.STATE_SNAPSHOT, snapshot: { plan: { city: null }, theme: 'dark' } })
    })

    it('publishes a node write as a delta, a streamed prediction before it, and nothing for unchanged state', async () => {
      const graph = makeGraph([
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: { id: 'm1', tool_call_chunks: [{ id: 'c1', name: 'set_city', args: '{"city":"Bang', index: 0 }] },
          },
        },
        {
          event: 'on_chat_model_stream',
          data: { chunk: { id: 'm1', tool_call_chunks: [{ args: 'kok"}', index: 0 }] } },
        },
        { event: 'on_chat_model_end', data: {} },
        nodeEnd('serverTools', { plan: { city: 'Bangkok' }, serverToolHops: 1 }),
        nodeEnd('agent', { plan: { city: 'Bangkok' } }),
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8, sharedState: SHARED })

      const deltas = stateEventsOf(await runToEvents(agent, baseInput()))
        .slice(1)
        .map((event) => {
          return event.delta
        })

      // The first chunk has no closed "city" string yet; the second completes the prediction.
      expect(deltas).toEqual([
        [{ op: 'replace', path: '/plan', value: { city: 'Bangkok', pending: true } }],
        [{ op: 'replace', path: '/plan', value: { city: 'Bangkok' } }],
      ])
    })

    it('takes back a prediction the graph never confirmed when the run fails', async () => {
      const graph: StreamableGraph = {
        streamEvents: () => {
          return (async function* () {
            yield {
              event: 'on_chat_model_stream',
              data: {
                chunk: {
                  id: 'm1',
                  tool_call_chunks: [{ id: 'c1', name: 'set_city', args: '{"city":"Paris"}', index: 0 }],
                },
              },
            } as never
            throw new Error('provider down')
          })()
        },
      }

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8, sharedState: SHARED })
      const seen: BaseEvent[] = []

      await new Promise<void>((resolve) => {
        agent.run(baseInput()).subscribe({
          next: (event) => {
            seen.push(event)
          },
          error: () => {
            resolve()
          },
        })
      })

      expect(stateEventsOf(seen).at(-1)?.delta).toEqual([{ op: 'replace', path: '/plan', value: { city: null } }])
    })

    it('emits no state events without a shared-state config', async () => {
      const graph = makeGraph([
        nodeEnd('serverTools', { plan: { city: 'Bangkok' } }),
        { event: 'on_chat_model_end', data: {} },
      ])

      const agent = new InProcessAgent({ graph, graphId: 'travelAiAgent', recursionLimit: 8 })

      expect(stateEventsOf(await runToEvents(agent, baseInput()))).toEqual([])
    })
  })
})
