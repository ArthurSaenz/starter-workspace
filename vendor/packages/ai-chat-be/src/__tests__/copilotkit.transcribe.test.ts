// The composer's microphone over the real wire: react-core posts the recording as multipart
// `audio` to `{runtimeUrl}/transcribe`; API Gateway (binary_media_types multipart/form-data) hands it
// to the Lambda base64-encoded. Real handler, real runtime route, real GeminiTranscriptionService —
// only the provider's HTTP endpoint is faked.
import type { Context } from 'aws-lambda'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'
import { hostOptions } from './helpers/handler-options.js'
import { TEST_JWT_SECRET, sessionCookie } from './helpers/session.js'

const PATH = '/v1/ai/copilotkit/transcribe'
const TRANSCRIPT = 'Which Bangkok hotels are on World of Hyatt?'
// Not valid UTF-8 on purpose: a body passed through as text would not survive.
const RECORDING = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28])

const context = {
  awsRequestId: 'transcribe-test',
  getRemainingTimeInMillis: () => {
    return 20_000
  },
} as unknown as Context

// A transcription must fit the day's budgets (`usage.ts`, tested against PGlite elsewhere); here it does.
const admission = vi.hoisted(() => {
  return { value: 'admitted' }
})

vi.mock('../lambda/usage.js', () => {
  return {
    admitDailyRun: async () => {
      return 'admitted'
    },
    admitDailySpend: async () => {
      return admission.value
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

interface MultipartEvent {
  body: string
  contentType: string
}

const multipartOf = async (audio: Uint8Array<ArrayBuffer>, mimeType: string): Promise<MultipartEvent> => {
  const form = new FormData()

  form.append('audio', new File([audio], 'recording.webm', { type: mimeType }))

  const request = new Request(`https://lambda.local${PATH}`, { method: 'POST', body: form })

  return {
    body: Buffer.from(await request.arrayBuffer()).toString('base64'),
    contentType: request.headers.get('content-type') ?? '',
  }
}

const transcribe = async (cookie: string | undefined, audio = RECORDING) => {
  const { body, contentType } = await multipartOf(audio, 'audio/webm;codecs=opus')

  return handler(
    {
      path: PATH,
      httpMethod: 'POST',
      headers: { host: 'lambda.local', 'content-type': contentType, ...(cookie ? { cookie } : {}) },
      body,
      isBase64Encoded: true,
    },
    context,
  )
}

const providerReplies = (status: number, body: unknown) => {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify(body), { status })
  })
}

describe('copilotkit transcribe route (multipart through the Lambda)', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)
    vi.stubEnv('GEMINI_API_KEY', 'fake-gemini-key')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('advertises transcription on /info, so the browser shows the microphone', async () => {
    const result = await handler(
      { path: '/v1/ai/copilotkit/info', httpMethod: 'GET', headers: { host: 'lambda.local', cookie: sessionCookie() } },
      context,
    )

    expect((JSON.parse(result.body) as { audioFileTranscriptionEnabled: boolean }).audioFileTranscriptionEnabled).toBe(
      true,
    )
  })

  it('returns the transcript, and the provider receives the recording byte for byte', async () => {
    const provider = providerReplies(200, { candidates: [{ content: { parts: [{ text: TRANSCRIPT }] } }] })

    const result = await transcribe(sessionCookie())

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({ text: TRANSCRIPT })

    const sent = JSON.parse(String(provider.mock.calls[0]?.[1]?.body)) as {
      contents: Array<{ parts: Array<{ inline_data?: { mime_type: string; data: string } }> }>
    }

    expect(sent.contents[0]?.parts[1]?.inline_data).toEqual({
      mime_type: 'audio/webm',
      data: Buffer.from(RECORDING).toString('base64'),
    })
  })

  it('refuses a caller without the traveller session before any provider call', async () => {
    const provider = providerReplies(200, {})

    const result = await transcribe(undefined)

    expect(result.statusCode).toBe(401)
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers a provider rate limit with 429 and its own words, never the provider text', async () => {
    providerReplies(429, { error: { message: 'Quota exceeded for project 1234 key AIza…' } })

    const result = await transcribe(sessionCookie())

    expect(result.statusCode).toBe(429)
    expect(result.body).not.toContain('1234')
    // The runtime recognises our fixed message and answers with its own retryable code.
    expect(JSON.parse(result.body)).toMatchObject({ error: 'rate_limited', retryable: true })
  })

  // A transcription bills the provider like a turn does; it passes the same budgets.
  it("refuses a recording over the day's budget, or once the global budget is spent, before the provider", async () => {
    const provider = providerReplies(200, {})

    try {
      admission.value = 'over_quota'
      expect((await transcribe(sessionCookie())).statusCode).toBe(429)

      admission.value = 'service_exhausted'

      const exhausted = await transcribe(sessionCookie())

      expect(exhausted.statusCode).toBe(503)
      expect(JSON.parse(exhausted.body)).toMatchObject({ type: 'SERVICE_BUDGET_EXHAUSTED' })
      expect(provider).not.toHaveBeenCalled()
    } finally {
      admission.value = 'admitted'
    }
  })

  it('refuses a body over the Lambda ceiling with 413 before the runtime', async () => {
    const provider = providerReplies(200, {})

    const result = await transcribe(sessionCookie(), new Uint8Array(600 * 1024))

    expect(result.statusCode).toBe(413)
    expect(provider).not.toHaveBeenCalled()
  })
})
