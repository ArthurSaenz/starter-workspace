import type { Context } from 'aws-lambda'
import { describe, expect, it, vi } from 'vitest'

import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'
import { hostOptions } from './helpers/handler-options.js'
import { TEST_JWT_SECRET, sessionCookie, signAccessToken } from './helpers/session.js'

// End-to-end test of the buffered handler against a stubbed CopilotKit runtime.
//
// This is the layer the unit tests missed: draining the runtime's own response is
// only exercised here, and the first live request failed on exactly that (the
// runtime writes its SSE stream as text, not bytes). The stub mirrors the real
// runtime's shape — createCopilotRuntimeHandler returns a fetch handler whose
// Response body is a TransformStream written as strings.
const sseFrame = (event: Record<string, unknown>): string => {
  return `data: ${JSON.stringify(event)}\n\n`
}

const RUN_FRAMES = [
  sseFrame({ type: 'RUN_STARTED', threadId: 't', runId: 'r' }),
  sseFrame({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }),
  sseFrame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'OK' }),
  sseFrame({ type: 'TEXT_MESSAGE_END', messageId: 'm' }),
  sseFrame({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' }),
]

/** A Response whose body streams the given chunks, mimicking the runtime's text TransformStream. */
const streamingResponse = (chunks: unknown[], delayMs = 0): Response => {
  const body = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0)
          await new Promise((r) => {
            return setTimeout(r, delayMs)
          })
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })

  return new Response(body as ReadableStream<Uint8Array>, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

let respond: (request: Request) => Response

vi.mock('@copilotkit/runtime/v2', () => {
  return {
    CopilotSseRuntime: class {},
    TranscriptionService: class {},
    createCopilotRuntimeHandler: () => {
      return async (request: Request) => {
        return respond(request)
      }
    },
  }
})

vi.mock('../copilotkit/inProcessAgent.js', () => {
  return { InProcessAgent: class {} }
})

vi.mock('../copilotkit/customerChatsRunner.js', () => {
  return { CustomerChatsRunner: class {} }
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

const { createCopilotkitHandlers } = await import('../lambda/copilotkit.js')

const { handler } = createCopilotkitHandlers({
  ...hostOptions(),
  loadAgent: async () => {
    return { graph: {} as StreamableGraph, graphId: 'travelAiAgent', recursionLimit: 8 }
  },
})

vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)

const event = {
  path: '/v1/ai/copilotkit/agent/travelAiAgent/run',
  httpMethod: 'POST',
  headers: { host: 'arthur.example.com', 'content-type': 'application/json', cookie: sessionCookie() },
  body: '{"threadId":"t"}',
  isBase64Encoded: false,
}

const contextWith = (remainingMs: number): Context => {
  return {
    awsRequestId: 'test',
    getRemainingTimeInMillis: () => {
      return remainingMs
    },
  } as unknown as Context
}

describe('buffered copilotkit handler', () => {
  it('answers 401 without touching the runtime when the traveller session is missing or forged', async () => {
    let runtimeCalls = 0

    respond = () => {
      runtimeCalls += 1

      return streamingResponse(RUN_FRAMES)
    }

    const anonymous = await handler({ ...event, headers: { host: 'arthur.example.com' } }, contextWith(28000))

    const forged = await handler(
      { ...event, headers: { ...event.headers, cookie: 'access_token=not-a-jwt' } },
      contextWith(28000),
    )

    expect(anonymous.statusCode).toBe(401)
    expect(forged.statusCode).toBe(401)
    expect(JSON.parse(anonymous.body)).toMatchObject({ type: 'UNAUTHENTICATED' })
    expect(runtimeCalls).toBe(0)
  })

  it('refuses a run whose body exceeds the ceiling before the runtime sees it', async () => {
    let runtimeCalls = 0

    respond = () => {
      runtimeCalls += 1

      return streamingResponse(RUN_FRAMES)
    }

    const result = await handler(
      { ...event, body: JSON.stringify({ threadId: 't', messages: [{ role: 'user', content: 'x'.repeat(600_000) }] }) },
      contextWith(28000),
    )

    expect(result.statusCode).toBe(413)
    expect(runtimeCalls).toBe(0)
  })

  it('throttles a traveller who hammers the run route on a warm container', async () => {
    respond = () => {
      return streamingResponse(RUN_FRAMES)
    }

    const hammer = {
      ...event,
      headers: { ...event.headers, cookie: sessionCookie(signAccessToken({ sub: 'hammer' })) },
    }

    const statuses: number[] = []

    for (let attempt = 0; attempt < 31; attempt += 1) {
      statuses.push((await handler(hammer, contextWith(28000))).statusCode)
    }

    expect(
      statuses.slice(0, 30).every((status) => {
        return status === 200
      }),
    ).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })

  it('keeps a separate suggestion budget, so a follow-up chip never costs the traveller a turn', async () => {
    respond = () => {
      return streamingResponse(RUN_FRAMES)
    }

    const cookie = sessionCookie(signAccessToken({ sub: 'suggester' }))
    const run = { ...event, headers: { ...event.headers, cookie } }

    // What CopilotKit's suggestion engine posts: the gate refuses a body without its forced tool.
    const suggest = {
      ...run,
      path: '/v1/ai/copilotkit/agent/travelAiAgent/suggest',
      body: JSON.stringify({ threadId: 't', tools: [{ name: 'copilotkitSuggest' }] }),
    }

    const suggestStatuses: number[] = []

    for (let attempt = 0; attempt < 31; attempt += 1) {
      suggestStatuses.push((await handler(suggest, contextWith(28000))).statusCode)
    }

    expect(
      suggestStatuses.slice(0, 30).every((status) => {
        return status === 200
      }),
    ).toBe(true)
    expect(suggestStatuses.at(-1)).toBe(429)
    expect((await handler(run, contextWith(28000))).statusCode).toBe(200)
  })

  it('never splices a hand-built threadId into the stop URL', async () => {
    const requests: string[] = []

    respond = (request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`)

      return streamingResponse(
        Array.from({ length: 200 }, () => {
          return sseFrame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'x' })
        }),
        30,
      )
    }

    const result = await handler({ ...event, body: '{"threadId":"../../threads/clear"}' }, contextWith(2000))

    expect(result.body).toContain('RUN_ERROR')
    expect(
      requests.some((line) => {
        return line.includes('/stop/')
      }),
    ).toBe(false)
    expect(
      requests.some((line) => {
        return line.includes('threads')
      }),
    ).toBe(false)
  })

  it('replaces a runtime 5xx body with the generic message, keeping the provider text out of the browser', async () => {
    respond = () => {
      return new Response('{"error":"Failed to run agent","message":"Insufficient Balance for key sk-…"}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await handler(event, contextWith(28000))

    expect(result.statusCode).toBe(500)
    expect(result.body).not.toContain('Insufficient')
    expect(JSON.parse(result.body)).toMatchObject({ type: 'INTERNAL_ERROR' })
  })

  it('lets a CORS pre-flight through without a session', async () => {
    const result = await handler({ ...event, httpMethod: 'OPTIONS', headers: { host: 'x' } }, contextWith(28000))

    expect(result.statusCode).not.toBe(401)
  })

  it('returns the whole SSE body when the runtime emits STRING chunks', async () => {
    respond = () => {
      return streamingResponse(RUN_FRAMES)
    }

    const result = await handler(event, contextWith(28000))

    expect(result.statusCode).toBe(200)
    expect(result.headers?.['Content-Type']).toBe('text/event-stream')
    expect(result.body).toBe(RUN_FRAMES.join(''))
    expect(result.body).toContain('RUN_STARTED')
    expect(result.body).toContain('RUN_FINISHED')
  })

  it('returns the whole SSE body when the runtime emits Uint8Array chunks', async () => {
    const encoder = new TextEncoder()

    respond = () => {
      return streamingResponse(
        RUN_FRAMES.map((f) => {
          return encoder.encode(f)
        }),
      )
    }

    const result = await handler(event, contextWith(28000))

    expect(result.statusCode).toBe(200)
    expect(result.body).toBe(RUN_FRAMES.join(''))
  })

  it('on overrun returns the complete frames received plus a RUN_ERROR, not a bare failure', async () => {
    // 30ms per chunk against a deadline of ~1s (2s remaining - the 3s margin is
    // clamped to a 1s floor) — the run cannot finish in time.
    let requestSignal: AbortSignal | undefined
    const requests: string[] = []

    respond = (request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`)

      if (request.url.includes('/stop/')) return new Response('{"stopped":true}', { status: 200 })

      requestSignal = request.signal

      return streamingResponse(
        Array.from({ length: 200 }, () => {
          return sseFrame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'x' })
        }),
        30,
      )
    }

    const result = await handler(event, contextWith(2000))

    expect(result.statusCode).toBe(200)
    // Every frame kept is complete, and the body ends with a parseable RUN_ERROR.
    expect(result.body.endsWith('\n\n')).toBe(true)
    expect(result.body).toContain('RUN_ERROR')
    // The signal closes the SSE stream; the stop route is what releases the runner's
    // thread lock and aborts the agent's provider call.
    expect(requestSignal?.aborted).toBe(true)
    expect(requests).toContain('POST /v1/ai/copilotkit/agent/travelAiAgent/stop/t')

    const frames = result.body.split('\n\n').filter(Boolean)

    for (const frame of frames) {
      expect(() => {
        return JSON.parse(frame.slice('data: '.length))
      }).not.toThrow()
    }
  })

  it('surfaces a runtime failure as a non-2xx with a JSON body, so the client throws', async () => {
    respond = () => {
      throw new Error('runtime exploded')
    }

    const result = await handler(event, contextWith(28000))

    expect(result.statusCode).toBeGreaterThanOrEqual(400)
    expect(result.headers?.['Content-Type']).toBe('application/json')
    expect(JSON.parse(result.body)).toHaveProperty('error')
  })
})
