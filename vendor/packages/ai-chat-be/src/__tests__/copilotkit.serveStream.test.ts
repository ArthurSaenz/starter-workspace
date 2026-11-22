import type { BaseEvent } from '@ag-ui/client'
import { EventType, HttpAgent } from '@ag-ui/client'
import type { Context } from 'aws-lambda'
import type { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'
import type { StreamMetadata } from '../lambda/copilotkit.js'
import { hostOptions } from './helpers/handler-options.js'
import { TEST_JWT_SECRET, sessionCookie } from './helpers/session.js'

// The streaming ingress against a stubbed runtime: what `serveStream` itself owns — frames leave as
// the runtime produces them, the gate answers before the runtime, the deadline ends a run with a
// RUN_ERROR. The same path with the real agent behind it is `@pkg/ai-travel-agent`'s stream test.
const sseFrame = (event: Record<string, unknown>): string => {
  return `data: ${JSON.stringify(event)}\n\n`
}

const words = ['Bangkok ', 'for ', 'three ', 'weeks.']

const RUN_FRAMES = [
  sseFrame({ type: 'RUN_STARTED', threadId: 't-stream', runId: 'r1' }),
  sseFrame({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }),
  ...words.map((delta) => {
    return sseFrame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta })
  }),
  sseFrame({ type: 'TEXT_MESSAGE_END', messageId: 'm' }),
  sseFrame({ type: 'RUN_FINISHED', threadId: 't-stream', runId: 'r1' }),
]

const runtime = vi.hoisted(() => {
  return { delayMs: 0, touched: false, status: 200, failAfter: undefined as number | undefined }
})

const streamingResponse = (): Response => {
  const body = new ReadableStream<string>({
    async start(controller) {
      for (const [index, frame] of RUN_FRAMES.entries()) {
        if (runtime.failAfter === index) {
          controller.error(new Error('runtime stream broke'))

          return
        }

        if (runtime.delayMs > 0) {
          await new Promise((resolve) => {
            return setTimeout(resolve, runtime.delayMs)
          })
        }

        controller.enqueue(frame)
      }

      controller.close()
    },
  })

  return new Response(body as unknown as ReadableStream<Uint8Array>, {
    status: runtime.status,
    headers: { 'content-type': 'text/event-stream' },
  })
}

vi.mock('@copilotkit/runtime/v2', () => {
  return {
    CopilotSseRuntime: class {},
    TranscriptionService: class {},
    createCopilotRuntimeHandler: () => {
      return async () => {
        runtime.touched = true

        return streamingResponse()
      }
    },
  }
})

// `order` interleaves the response stream's end with the trace flush, which must come after it.
const traces = vi.hoisted(() => {
  return { order: [] as string[], hang: false }
})

vi.mock('@langchain/core/callbacks/promises', () => {
  return {
    awaitAllCallbacks: vi.fn(async () => {
      traces.order.push('flush')

      if (traces.hang) {
        await new Promise(() => {})
      }
    }),
  }
})

vi.mock('../copilotkit/inProcessAgent.js', () => {
  return { InProcessAgent: class {} }
})

vi.mock('../copilotkit/customerChatsRunner.js', () => {
  return { CustomerChatsRunner: class {} }
})

// The vote's storage is proven against PGlite in copilotkit.usage.test.ts; here only its response.
vi.mock('../lambda/feedback.js', () => {
  return {
    storeFeedback: async () => {
      return 'stored'
    },
  }
})

// The daily quota is a database counter, proven against PGlite in copilotkit.usage.test.ts.
vi.mock('../lambda/usage.js', () => {
  return {
    admitDailyRun: async () => {
      return 'admitted'
    },
    admitDailySpend: async () => {
      return 'admitted'
    },
  }
})

const { HEARTBEAT_FRAME, TRACE_FLUSH_CAP_MS, createCopilotkitHandlers } = await import('../lambda/copilotkit.js')

const { serveStream, streamHandler } = createCopilotkitHandlers({
  ...hostOptions(),
  loadAgent: async () => {
    return { graph: {} as StreamableGraph, graphId: 'travelAiAgent', recursionLimit: 8 }
  },
})

const RUNTIME_URL = 'https://lambda.local/v1/ai/copilotkit'
const RUN_PATH = '/v1/ai/copilotkit/agent/travelAiAgent/run'

const contextWith = (remainingMs: number): Context => {
  return {
    awsRequestId: 'stream-test',
    getRemainingTimeInMillis: () => {
      return remainingMs
    },
  } as unknown as Context
}

interface Captured {
  metadata?: StreamMetadata
  writes: string[]
  writeTimes: number[]
}

const serve = async (headers: Record<string, string> = { cookie: sessionCookie() }, remainingMs = 20_000) => {
  const captured: Captured = { writes: [], writeTimes: [] }
  const startedAt = Date.now()

  await serveStream(
    {
      path: RUN_PATH,
      httpMethod: 'POST',
      headers: { host: 'lambda.local', 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ threadId: 't-stream', runId: 'r1', messages: [], tools: [], context: [], state: {} }),
    },
    contextWith(remainingMs),
    (metadata) => {
      const out = new PassThrough()

      captured.metadata = metadata
      out.on('finish', () => {
        traces.order.push('stream-end')
      })
      out.on('data', (chunk: Buffer) => {
        captured.writes.push(chunk.toString())
        captured.writeTimes.push(Date.now() - startedAt)
      })

      return out
    },
  )

  return captured
}

const typesOf = (body: string): string[] => {
  return body
    .split('\n\n')
    .filter((frame) => {
      return frame.startsWith('data: ')
    })
    .map((frame) => {
      return (JSON.parse(frame.slice('data: '.length)) as { type: string }).type
    })
}

describe('copilotkit streaming ingress against a stubbed runtime', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)
    runtime.delayMs = 0
    runtime.touched = false
    runtime.status = 200
    runtime.failAfter = undefined
  })

  // LIVE-2: the Lambda stream sends its status prelude only with the first body write, so an empty
  // body (the old 204) reached API Gateway with no status line and came back as a 502.
  it('answers a stored vote with a body, so the streamed status line is always sent', async () => {
    const writes: string[] = []
    let metadata: StreamMetadata | undefined

    await serveStream(
      {
        path: '/v1/ai/copilotkit/feedback',
        httpMethod: 'POST',
        headers: { host: 'lambda.local', 'content-type': 'application/json', cookie: sessionCookie() },
        body: JSON.stringify({ threadId: 't1', messageId: 'm1', rating: 'up' }),
      },
      contextWith(20_000),
      (opened) => {
        const out = new PassThrough()

        metadata = opened
        out.on('data', (chunk: Buffer) => {
          writes.push(chunk.toString())
        })

        return out
      },
    )

    expect(metadata?.statusCode).toBe(200)
    expect(JSON.parse(writes.join(''))).toEqual({ stored: true })
    expect(runtime.touched).toBe(false)
  })

  // A traveller who closes the tab or presses Stop is not a server fault: no error, nothing thrown.
  it('ends quietly when the client already closed the stream', async () => {
    const errors = vi.spyOn(process.stderr, 'write')

    try {
      await serveStream(
        {
          path: RUN_PATH,
          httpMethod: 'POST',
          headers: { host: 'lambda.local', 'content-type': 'application/json', cookie: sessionCookie() },
          body: JSON.stringify({ threadId: 't-stream', runId: 'r1', messages: [] }),
        },
        contextWith(20_000),
        () => {
          const out = new PassThrough()

          out.once('data', () => {
            out.destroy()
          })
          out.resume()

          return out
        },
      )

      const logged = errors.mock.calls.map((call) => {
        return String(call[0])
      })

      expect(
        logged.filter((line) => {
          return line.includes('"level":"ERROR"')
        }),
      ).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })

  it('writes each frame as the runtime produces it, every write on a frame boundary', async () => {
    runtime.delayMs = 40

    const captured = await serve()

    expect(captured.metadata?.statusCode).toBe(200)
    expect(captured.metadata?.headers['x-ai-request-id']).toBe('stream-test')
    expect(captured.writes.length).toBeGreaterThanOrEqual(RUN_FRAMES.length)
    expect((captured.writeTimes.at(-1) ?? 0) - (captured.writeTimes[0] ?? 0)).toBeGreaterThanOrEqual(
      (RUN_FRAMES.length - 2) * runtime.delayMs,
    )

    for (const write of captured.writes) {
      expect(write.endsWith('\n\n'), JSON.stringify(write)).toBe(true)
    }
  })

  it('answers the gate with the Lambda JSON body and never touches the runtime', async () => {
    const captured = await serve({})

    expect(captured.metadata?.statusCode).toBe(401)
    expect(JSON.parse(captured.writes.join(''))).toMatchObject({ type: 'UNAUTHENTICATED' })
    expect(runtime.touched).toBe(false)
  })

  it('hides a runtime 5xx behind the generic body', async () => {
    runtime.status = 502

    const captured = await serve()

    expect(captured.metadata?.statusCode).toBe(502)
    expect(JSON.parse(captured.writes.join(''))).toMatchObject({ type: 'INTERNAL_ERROR' })
  })

  it('ends a run that outlives the deadline with whole frames and a RUN_ERROR', async () => {
    runtime.delayMs = 300

    // MIN_DRAIN_MS floor: 1 s of stream before the watchdog fires.
    const types = typesOf((await serve(undefined, 0)).writes.join(''))

    expect(types.at(-1)).toBe(EventType.RUN_ERROR)
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT)
  })

  it('ends a stream that breaks after the status line with a RUN_ERROR frame', async () => {
    runtime.failAfter = 3

    const captured = await serve()

    expect(captured.metadata?.statusCode).toBe(200)
    expect(typesOf(captured.writes.join('')).at(-1)).toBe(EventType.RUN_ERROR)
  })

  it('is read by the AG-UI HttpAgent chunk by chunk, heartbeat comments included', async () => {
    const fetchViaStream = async (url: string, init: RequestInit): Promise<Response> => {
      const parsed = new URL(url)
      const headers: Record<string, string> = { host: parsed.host, cookie: sessionCookie() }

      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value
      })

      let resolveHead: (metadata: StreamMetadata) => void = () => {}

      const head = new Promise<StreamMetadata>((resolve) => {
        resolveHead = resolve
      })

      const body = new TransformStream<string, Uint8Array>({
        transform: (chunk, controller) => {
          controller.enqueue(new TextEncoder().encode(chunk))
        },
      })

      const writer = body.writable.getWriter()

      void serveStream(
        { path: parsed.pathname, httpMethod: init.method ?? 'GET', headers, body: (init.body as string) ?? null },
        contextWith(20_000),
        (metadata) => {
          const out = new PassThrough()

          out.on('data', (chunk: Buffer) => {
            // A heartbeat before every frame: the parser must skip SSE comments.
            void writer.write(HEARTBEAT_FRAME + chunk.toString())
          })
          out.on('end', () => {
            void writer.close()
          })
          resolveHead(metadata)

          return out
        },
      )

      const metadata = await head

      return new Response(body.readable, { status: metadata.statusCode, headers: metadata.headers })
    }

    const agent = new HttpAgent({ url: `${RUNTIME_URL}/agent/travelAiAgent/run`, fetch: fetchViaStream })

    agent.messages = [{ id: 'm1', role: 'user', content: 'Plan Bangkok' }]

    const events: BaseEvent[] = []

    const result = await agent.runAgent(
      {},
      {
        onEvent: ({ event }) => {
          events.push(event)
        },
      },
    )

    const assistant = result.newMessages.find((message) => {
      return message.role === 'assistant'
    })

    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED)
    expect(assistant && 'content' in assistant ? assistant.content : '').toBe(words.join(''))
  })

  it('has no Lambda stream wrapper off the Lambda runtime', () => {
    expect(streamHandler).toBeUndefined()
  })
})

describe('langSmith trace flush after the stream', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)
    runtime.delayMs = 0
    runtime.status = 200
    runtime.failAfter = undefined
    traces.order = []
    traces.hang = false
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('flushes queued traces once the stream has ended when tracing is on', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')

    await serve()

    expect(traces.order).toEqual(['stream-end', 'flush'])
  })

  it('does nothing when tracing is off', async () => {
    vi.stubEnv('LANGSMITH_TRACING', '')

    await serve()

    expect(traces.order).toEqual(['stream-end'])
  })

  it('stops waiting on a stuck flush at the cap', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    traces.hang = true
    const startedAt = Date.now()

    await serve()

    expect(traces.order).toEqual(['stream-end', 'flush'])
    expect(Date.now() - startedAt).toBeLessThan(TRACE_FLUSH_CAP_MS + 1000)
  }, 10_000)

  // Last in the file: the handed-over copy stays registered for the module's lifetime.
  it("also drains the queue of the agent's own @langchain/core copy", async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_HIDE_INPUTS', undefined)
    vi.stubEnv('LANGSMITH_HIDE_OUTPUTS', undefined)
    const { maskTraceContent } = await import('../langgraph/traceMasking.js')

    await maskTraceContent([
      {
        LangChainTracer: class {
          client = {}
        },
        awaitAllCallbacks: async () => {
          traces.order.push('agent-copy-flush')
        },
      },
    ])
    await serve()

    expect(traces.order).toEqual(['stream-end', 'flush', 'agent-copy-flush'])
  })
})
