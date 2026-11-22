// `flushTraces` relies on core's `awaitAllCallbacks` draining LangSmith's background batch queue
// before the Lambda freezes. Here the real `LangChainTracer` and LangSmith client trace one run
// against a recorded LangSmith endpoint, so a langsmith bump that queues, compresses or sends runs
// differently (0.12 zstd, the 0.11-0.13 tracer changes) and leaves the batch unsent fails here.
import { RunnableLambda } from '@langchain/core/runnables'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { flushTraces } from '../lambda/copilotkit.js'

const ENDPOINT = 'https://langsmith.test'
const RUN_NAME = 'flush-traces-guard-run'

interface SentRequest {
  url: string
  method: string
  headers: Headers
  body: string
}

const sent: SentRequest[] = []

// Shaped like a LangSmith `/info` answer; without one the client falls back to defaults, which would
// keep the compressed / multipart paths a real server enables out of the test.
const SERVER_INFO = {
  version: '0.11.0',
  batch_ingest_config: {
    use_multipart_endpoint: true,
    scale_up_qsize_trigger: 1000,
    scale_up_nthreads_limit: 16,
    scale_down_nempty_trigger: 4,
    size_limit: 100,
    size_limit_bytes: 20_971_520,
  },
  instance_flags: { zstd_compression_enabled: true },
}

const fakeLangSmith = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input)

  if (!url.startsWith(ENDPOINT)) throw new Error(`unexpected network call in test: ${url}`)

  const headers = new Headers(init?.headers)
  const isCompressed = headers.get('content-encoding') !== null

  const body =
    init?.body === undefined || init.body === null || isCompressed ? '' : await new Response(init.body).text()

  sent.push({ url, method: init?.method ?? 'GET', headers, body })

  if (url.endsWith('/info')) return Response.json(SERVER_INFO)

  return Response.json({}, { status: 202 })
}

const isRunIngest = (request: SentRequest): boolean => {
  return request.method === 'POST' && /\/runs(?:\/batch|\/multipart)?$/.test(new URL(request.url).pathname)
}

describe('flushTraces with the real LangSmith tracer', () => {
  beforeEach(() => {
    sent.length = 0
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_API_KEY', 'lsv2_test_dummy')
    vi.stubEnv('LANGSMITH_ENDPOINT', ENDPOINT)
    vi.stubEnv('LANGSMITH_PROJECT', 'flush-traces-test')
    vi.stubGlobal('fetch', vi.fn(fakeLangSmith))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('has sent the traced run to LangSmith by the time it resolves', async () => {
    const traced = RunnableLambda.from(async (question: string) => {
      return `answer to ${question}`
    }).withConfig({ runName: RUN_NAME })

    await traced.invoke('which hotel?')
    await flushTraces()

    const ingests = sent.filter(isRunIngest)

    expect(ingests.length).toBeGreaterThan(0)

    // A compressed body cannot be read here; its URL and headers still show the batch left.
    const plain = ingests.filter((request) => {
      return request.body.length > 0
    })

    if (plain.length === 0) {
      expect(ingests[0]?.headers.get('content-encoding')).toBe('zstd')
      expect(ingests[0]?.url).toBe(`${ENDPOINT}/runs/multipart`)

      return
    }

    expect(
      plain.some((request) => {
        return request.body.includes(RUN_NAME)
      }),
    ).toBe(true)
  })
})
