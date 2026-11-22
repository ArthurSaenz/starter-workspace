// SEC-21: the A2UI middleware paints any tool result that carries `a2ui_operations`, so a tool that
// echoes outside text could draw a surface; only the render tool's result may.
import { EventType } from '@ag-ui/client'
import type { AbstractAgent, BaseEvent, Message, RunAgentInput, ToolCallResultEvent } from '@ag-ui/client'
import { lastValueFrom, of, toArray } from 'rxjs'
import { describe, expect, it } from 'vitest'

import {
  A2UI_ACTION_MESSAGE_NAME,
  A2UI_CANCELLED_RESULT,
  A2UI_RENDERED_RESULT,
  A2uiToolResultGuard,
  RENDER_A2UI_TOOL_NAME,
  a2uiRenderToolNames,
  guardA2uiMiddleware,
  withoutA2uiOperations,
} from '../copilotkit/a2ui.js'
import { InProcessAgent } from '../copilotkit/inProcessAgent.js'
import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'

const OPERATIONS = [{ version: 'v0.9', createSurface: { surfaceId: 'phish', catalogId: 'basic' } }]
const INPUT = { threadId: 't', runId: 'r', messages: [], tools: [], context: [], state: {} } as unknown as RunAgentInput

const toolCall = (toolCallId: string, toolCallName: string, content: string): BaseEvent[] => {
  return [
    { type: EventType.TOOL_CALL_START, toolCallId, toolCallName } as BaseEvent,
    { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent,
    { type: EventType.TOOL_CALL_RESULT, messageId: `m-${toolCallId}`, toolCallId, content } as BaseEvent,
  ]
}

const resultsThrough = async (events: BaseEvent[]): Promise<Map<string, string>> => {
  const next = {
    run: () => {
      return of(...events)
    },
  } as unknown as AbstractAgent

  const out = await lastValueFrom(
    new A2uiToolResultGuard(new Set([RENDER_A2UI_TOOL_NAME])).run(INPUT, next).pipe(toArray()),
  )

  return new Map(
    out
      .filter((event) => {
        return event.type === EventType.TOOL_CALL_RESULT
      })
      .map((event) => {
        const { toolCallId, content } = event as ToolCallResultEvent

        return [toolCallId, typeof content === 'string' ? content : JSON.stringify(content)]
      }),
  )
}

describe('a2UI tool result guard', () => {
  it("drops a2ui_operations from any other tool's result, plain or JSON-in-a-string, and keeps the rest", async () => {
    const plain = JSON.stringify({ title: 'Page', a2ui_operations: OPERATIONS })
    const wrapped = JSON.stringify(JSON.stringify({ a2ui_operations: OPERATIONS, note: 'x' }))

    const results = await resultsThrough([
      ...toolCall('web', 'web_read', plain),
      ...toolCall('memory', 'search_past_chats', wrapped),
      ...toolCall('render', RENDER_A2UI_TOOL_NAME, JSON.stringify({ a2ui_operations: OPERATIONS })),
      ...toolCall('text', 'hotel_search', 'not json at all'),
    ])

    expect(JSON.parse(results.get('web') ?? '')).toEqual({ title: 'Page' })
    expect(JSON.parse(JSON.parse(results.get('memory') ?? '') as string)).toEqual({ note: 'x' })
    expect(JSON.parse(results.get('render') ?? '')).toEqual({ a2ui_operations: OPERATIONS })
    expect(results.get('text')).toBe('not json at all')
  })

  it('passes an AG-UI 1.0 multimodal result through untouched', async () => {
    const parts = [{ type: 'text', text: JSON.stringify({ a2ui_operations: OPERATIONS }) }]

    const results = await resultsThrough([
      { type: EventType.TOOL_CALL_START, toolCallId: 'parts', toolCallName: 'web_read' } as BaseEvent,
      { type: EventType.TOOL_CALL_RESULT, messageId: 'm-parts', toolCallId: 'parts', content: parts } as BaseEvent,
    ])

    expect(JSON.parse(results.get('parts') ?? '')).toEqual(parts)
  })

  it('leaves a result without operations byte for byte', () => {
    const content = '{ "spaced": true }'

    expect(withoutA2uiOperations(content)).toBe(content)
  })

  // The runtime adds the middleware itself on every request; the agent slots the guard inside it.
  it('places a guard nearer the agent than every A2UI middleware the runtime adds, and only those', () => {
    const a2ui = {
      config: {},
      injectSchemaContext: () => {},
      processStream: () => {},
      run: () => {
        return of()
      },
    }

    const other = {
      run: () => {
        return of()
      },
    }

    const guarded = guardA2uiMiddleware([other as never, a2ui as never])

    expect(guarded).toHaveLength(3)
    expect(guarded[1]).toBe(a2ui)
    expect(guarded[2]).toBeInstanceOf(A2uiToolResultGuard)

    const agent = new InProcessAgent({ graph: {} as StreamableGraph, graphId: 'g', recursionLimit: 4 })

    agent.use(a2ui as never)

    expect((agent as unknown as { middlewares: unknown[] }).middlewares.at(-1)).toBeInstanceOf(A2uiToolResultGuard)
  })
})

describe('a2uiRenderToolNames', () => {
  it.each([
    [{}, [RENDER_A2UI_TOOL_NAME]],
    [{ injectA2UITool: true }, [RENDER_A2UI_TOOL_NAME]],
    [{ injectA2UITool: 'draw' }, [RENDER_A2UI_TOOL_NAME, 'draw']],
    [{ injectA2UITool: '' }, [RENDER_A2UI_TOOL_NAME]],
    [{ a2uiToolNames: ['paint'] }, ['paint']],
    [{ a2uiToolNames: ['paint'], injectA2UITool: true }, ['paint', RENDER_A2UI_TOOL_NAME]],
  ])('names the tools the middleware answers for %j', (config, names) => {
    expect([...a2uiRenderToolNames(config)]).toEqual(names)
  })
})

it("matches the name the middleware gives a button press's message, and nothing a traveller's client would send", () => {
  expect(A2UI_ACTION_MESSAGE_NAME.test(`a2ui_action_context_${'a'.repeat(43)}`)).toBe(true)
  expect(A2UI_ACTION_MESSAGE_NAME.test(`a2ui_action_context_${'-_'.repeat(21)}A`)).toBe(true)
  expect(A2UI_ACTION_MESSAGE_NAME.test(`a2ui_action_context_${'a'.repeat(42)}`)).toBe(false)
  expect(A2UI_ACTION_MESSAGE_NAME.test(`x_a2ui_action_context_${'a'.repeat(43)}`)).toBe(false)
  expect(A2UI_ACTION_MESSAGE_NAME.test('traveller')).toBe(false)
})

// `@ag-ui/a2ui-middleware` 0.0.16 runs the agent again once it has answered a render call. After a
// painted surface that second run has nothing to add, so the guard ends it without a model call.
describe('a2UI tool result guard: a run that ends on painted surfaces', () => {
  const draws = (...calls: [id: string, name?: string][]): Message => {
    return {
      id: 'a1',
      role: 'assistant',
      toolCalls: calls.map(([id, name = RENDER_A2UI_TOOL_NAME]) => {
        return { id, type: 'function', function: { name, arguments: '{}' } }
      }),
    }
  }

  const tool = (toolCallId: string, content: string): Message => {
    return { id: `r-${toolCallId}`, role: 'tool', toolCallId, content }
  }

  const FAILED = JSON.stringify({ status: 'failed', code: 'a2ui_render_failed', error: 'Invalid A2UI components' })
  const ASKED: Message = { id: 'u1', role: 'user', content: 'Compare them' }
  const SURFACE = { id: 'a2ui-surface-c1', role: 'activity', activityType: 'a2ui-surface', content: {} } as Message
  const PROGRESS = { id: 'progress-r', role: 'activity', activityType: 'agent-progress', content: {} } as Message
  const THOUGHT = { id: 'th1', role: 'reasoning', content: 'Two hotels, one card each.' } as Message

  const throughGuard = async (messages: Message[], extra: Partial<RunAgentInput> = {}) => {
    let calls = 0

    const next = {
      run: () => {
        calls += 1

        return of({ type: EventType.RUN_STARTED, threadId: 't', runId: 'r' } as BaseEvent)
      },
    } as unknown as AbstractAgent

    const input = { ...INPUT, messages, ...extra } as RunAgentInput

    const events = await lastValueFrom(
      new A2uiToolResultGuard(new Set([RENDER_A2UI_TOOL_NAME])).run(input, next).pipe(toArray()),
    )

    return { calls, events }
  }

  it('ends the run with RUN_STARTED and RUN_FINISHED alone, under the run it was given', async () => {
    const { calls, events } = await throughGuard([ASKED, draws(['c1']), tool('c1', A2UI_RENDERED_RESULT)])

    expect(calls).toBe(0)
    expect(events).toEqual([
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r' },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r' },
    ])
  })

  it.each([
    ['a surface activity after the result', [draws(['c1']), tool('c1', A2UI_RENDERED_RESULT), SURFACE]],
    ['the progress line between the call and its result', [draws(['c1']), PROGRESS, tool('c1', A2UI_RENDERED_RESULT)]],
    ['reasoning after the result', [draws(['c1']), tool('c1', A2UI_RENDERED_RESULT), THOUGHT]],
    [
      'two surfaces, both painted',
      [draws(['c1'], ['c2']), tool('c2', A2UI_RENDERED_RESULT), tool('c1', A2UI_RENDERED_RESULT)],
    ],
  ])('ends the run past %s', async (_case, tail) => {
    expect((await throughGuard([ASKED, ...tail])).calls).toBe(0)
  })

  it.each([
    [
      'the traveller said something after the surface (a follow-up, or a button press)',
      [draws(['c1']), tool('c1', A2UI_RENDERED_RESULT), SURFACE, { ...ASKED, id: 'u2' }],
    ],
    ['one of two renders failed', [draws(['c1'], ['c2']), tool('c1', FAILED), tool('c2', A2UI_RENDERED_RESULT)]],
    ['the render was cancelled', [draws(['c1']), tool('c1', A2UI_CANCELLED_RESULT)]],
    ['the render has no result yet', [draws(['c1'])]],
    ['one of two renders has no result', [draws(['c1'], ['c2']), tool('c1', A2UI_RENDERED_RESULT)]],
    ["the result is another tool's", [draws(['c1', 'hotel_search']), tool('c1', A2UI_RENDERED_RESULT)]],
    [
      'the turn also called a server tool',
      [draws(['c1'], ['c2', 'hotel_search']), tool('c1', A2UI_RENDERED_RESULT), tool('c2', '{"hotels":[]}')],
    ],
    [
      'a result answers a call the turn never made',
      [draws(['c1']), tool('c1', A2UI_RENDERED_RESULT), tool('c9', A2UI_RENDERED_RESULT)],
    ],
    ['the result is not JSON', [draws(['c1']), tool('c1', 'rendered')]],
    ['the history ends on plain text', [{ id: 'a1', role: 'assistant', content: 'Here you go.' } as Message]],
    ['the history is only the question', []],
  ])('hands the run to the agent when %s', async (_case, tail) => {
    expect((await throughGuard([ASKED, ...tail])).calls).toBe(1)
  })

  it.each([
    ['an AG-UI resume', { resume: [{ interruptId: 'i1', status: 'resolved', payload: {} }] }],
    ['a forwarded resume command', { forwardedProps: { command: { resume: 'yes' } } }],
  ])('hands %s to the agent, whatever the history ends on', async (_case, extra) => {
    const painted = [ASKED, draws(['c1']), tool('c1', A2UI_RENDERED_RESULT)]

    expect((await throughGuard(painted, extra as Partial<RunAgentInput>)).calls).toBe(1)
  })
})
