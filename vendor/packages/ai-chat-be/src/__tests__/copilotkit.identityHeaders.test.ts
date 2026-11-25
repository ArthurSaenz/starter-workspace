import type { APIGatewayProxyResult, Context } from 'aws-lambda'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'
import { hostOptions } from './helpers/handler-options.js'
import { TEST_JWT_SECRET, sessionCookie, signAccessToken } from './helpers/session.js'

// Every response carries `x-ai-request-id` and `x-ai-model` so an e2e run can name the model
// that answered and correlate the turn with CloudWatch. The reject paths must still not touch
// the graph: the host's `loadAgent` runs on first use so a 404 or 401 pays no cold start, and
// `graphImport` below is the guard on that.
const graphImport = vi.hoisted(() => {
  return { happened: false }
})

const sseFrame = (event: Record<string, unknown>): string => {
  return `data: ${JSON.stringify(event)}\n\n`
}

const RUN_FRAMES = [
  sseFrame({ type: 'RUN_STARTED', threadId: 't', runId: 'r' }),
  sseFrame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'OK' }),
  sseFrame({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' }),
]

const streamingResponse = (): Response => {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of RUN_FRAMES) controller.enqueue(chunk)
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

const CORPUS_SNAPSHOT_ID = 'snapshot-test'

const { createCopilotkitHandlers } = await import('../lambda/copilotkit.js')

const { handler } = createCopilotkitHandlers({
  ...hostOptions(),
  loadAgent: async () => {
    graphImport.happened = true

    return { graph: {} as StreamableGraph, graphId: 'travelAiAgent', recursionLimit: 8 }
  },
  identityHeaders: {
    'x-ai-corpus-snapshot': () => {
      return CORPUS_SNAPSHOT_ID
    },
  },
})

const TEST_API_KEY = 'sk-deepseek-test-key-must-never-leak'
const SECRET_USER_TEXT = 'my passport number is 987654321'

const runEvent = {
  path: '/v1/ai/copilotkit/agent/travelAiAgent/run',
  httpMethod: 'POST',
  headers: { host: 'arthur.example.com', 'content-type': 'application/json', cookie: sessionCookie() },
  body: JSON.stringify({ threadId: 't', messages: [{ role: 'user', content: SECRET_USER_TEXT }] }),
  isBase64Encoded: false,
}

// A path the allow-list rejects: one of the runtime's hidden thread routes.
const forbiddenEvent = { ...runEvent, path: '/v1/ai/copilotkit/threads/clear' }

const CONTEXT = {
  awsRequestId: 'req-identity-1',
  getRemainingTimeInMillis: () => {
    return 28000
  },
} as unknown as Context

const identityOf = (result: APIGatewayProxyResult) => {
  return {
    requestId: result.headers?.['x-ai-request-id'],
    model: result.headers?.['x-ai-model'],
  }
}

describe('copilotkit identity headers', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)
    vi.stubEnv('DEEPSEEK_API_KEY', TEST_API_KEY)
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LANGGRAPH_MODEL_ID', undefined)
    respond = () => {
      return streamingResponse()
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // First in the file on purpose: `getFetchHandler` caches the runtime for the whole module,
  // so once any test has run a request successfully the graph stays imported.
  it('labels a 404 and a 401 without ever importing the graph', async () => {
    const notFound = await handler(forbiddenEvent, CONTEXT)
    const unauthorized = await handler({ ...runEvent, headers: { host: 'arthur.example.com' } }, CONTEXT)

    expect(notFound.statusCode).toBe(404)
    expect(unauthorized.statusCode).toBe(401)
    expect(identityOf(notFound)).toEqual({ requestId: 'req-identity-1', model: 'anthropic/claude-opus-5-5' })
    expect(identityOf(unauthorized)).toEqual({ requestId: 'req-identity-1', model: 'anthropic/claude-opus-5-5' })
    expect(graphImport.happened).toBe(false)

    const success = await handler(runEvent, CONTEXT)

    expect(success.statusCode).toBe(200)
    expect(graphImport.happened).toBe(true)
  })

  it('labels a successful run', async () => {
    const result = await handler(runEvent, CONTEXT)

    expect(result.statusCode).toBe(200)
    expect(result.headers?.['Content-Type']).toBe('text/event-stream')
    expect(identityOf(result)).toEqual({ requestId: 'req-identity-1', model: 'anthropic/claude-opus-5-5' })
  })

  it('labels a body over the ceiling and a throttled run', async () => {
    const oversized = await handler(
      {
        ...runEvent,
        body: JSON.stringify({ threadId: 't', messages: [{ role: 'user', content: 'x'.repeat(600_000) }] }),
      },
      CONTEXT,
    )

    expect(oversized.statusCode).toBe(413)
    expect(identityOf(oversized)).toEqual({ requestId: 'req-identity-1', model: 'anthropic/claude-opus-5-5' })

    const hammer = {
      ...runEvent,
      headers: { ...runEvent.headers, cookie: sessionCookie(signAccessToken({ sub: 'identity-hammer' })) },
    }

    let throttled: APIGatewayProxyResult | undefined

    for (let attempt = 0; attempt < 31; attempt += 1) {
      throttled = await handler(hammer, CONTEXT)
    }

    expect(throttled?.statusCode).toBe(429)
    expect(identityOf(throttled as APIGatewayProxyResult)).toEqual({
      requestId: 'req-identity-1',
      model: 'anthropic/claude-opus-5-5',
    })
  })

  it('labels a runtime 5xx and a thrown failure', async () => {
    respond = () => {
      return new Response('{"error":"Insufficient Balance"}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }

    const runtimeError = await handler(runEvent, CONTEXT)

    expect(runtimeError.statusCode).toBe(500)
    expect(identityOf(runtimeError)).toEqual({ requestId: 'req-identity-1', model: 'anthropic/claude-opus-5-5' })

    respond = () => {
      throw new Error('runtime exploded')
    }

    const thrown = await handler(runEvent, CONTEXT)

    expect(thrown.statusCode).toBeGreaterThanOrEqual(400)
    expect(identityOf(thrown)).toEqual({ requestId: 'req-identity-1', model: 'anthropic/claude-opus-5-5' })
  })

  it('reports noRequestId when the invocation carries no context id', async () => {
    const result = await handler(forbiddenEvent, {} as unknown as Context)

    expect(result.statusCode).toBe(404)
    expect(identityOf(result).requestId).toBe('noRequestId')
  })

  it('follows the configured provider and model id', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')

    const onDefault = await handler(forbiddenEvent, CONTEXT)

    expect(identityOf(onDefault).model).toBe('gemini/gemini-2.5-flash')

    vi.stubEnv('LANGGRAPH_MODEL_ID', 'gemini-3.0-pro')

    const onOverride = await handler(runEvent, CONTEXT)

    expect(onOverride.statusCode).toBe(200)
    expect(identityOf(onOverride).model).toBe('gemini/gemini-3.0-pro')
  })

  // A misconfigured provider fails the graph's own load; it must not turn a route rejection
  // into a 500 on the way out.
  it('keeps a 404 a 404 under an unknown provider', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')

    const result = await handler(forbiddenEvent, CONTEXT)

    expect(result.statusCode).toBe(404)
    expect(identityOf(result).model).toBe('openai/unknown')
  })

  it('keeps a 404 a 404 with no provider set', async () => {
    vi.stubEnv('LLM_PROVIDER', undefined)

    const result = await handler(forbiddenEvent, CONTEXT)

    expect(result.statusCode).toBe(404)
    expect(identityOf(result).model).toBe('unset/unknown')
  })

  it('names the bundled research-corpus snapshot on a success and on a rejection', async () => {
    const results = [await handler(runEvent, CONTEXT), await handler(forbiddenEvent, CONTEXT)]

    for (const result of results) {
      expect(result.headers?.['x-ai-corpus-snapshot']).toBe(CORPUS_SNAPSHOT_ID)
    }
  })

  it('exposes every identity header to an allowed cross-origin caller, and none to a stranger', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'https://nomadream.ai')

    const allowed = await handler(
      { ...runEvent, headers: { ...runEvent.headers, origin: 'https://nomadream.ai' } },
      CONTEXT,
    )

    const stranger = await handler(
      { ...runEvent, headers: { ...runEvent.headers, origin: 'https://evil.example' } },
      CONTEXT,
    )

    expect(allowed.headers?.['Access-Control-Expose-Headers']).toBe('x-ai-request-id, x-ai-model, x-ai-corpus-snapshot')
    expect(stranger.headers?.['Access-Control-Expose-Headers']).toBeUndefined()
  })

  it('never carries the API key or the traveller message in a header', async () => {
    const results = [
      await handler(runEvent, CONTEXT),
      await handler(forbiddenEvent, CONTEXT),
      await handler({ ...runEvent, headers: { host: 'arthur.example.com' } }, CONTEXT),
    ]

    for (const result of results) {
      const serialized = JSON.stringify(result.headers)

      expect(serialized).not.toContain(TEST_API_KEY)
      expect(serialized).not.toContain('passport')
      expect(serialized).not.toContain('access_token')
    }
  })
})
