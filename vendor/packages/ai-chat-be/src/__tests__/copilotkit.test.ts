import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { buildRequest, buildRunErrorFrame, decodeChunk, truncateToLastCompleteFrame } from '../lambda/copilotkit.js'

describe('copilotkit Lambda bridge', () => {
  describe('buildRequest', () => {
    it('builds an absolute URL from a REST API Gateway (v1) event', () => {
      const request = buildRequest({
        path: '/v1/ai/copilotkit',
        httpMethod: 'POST',
        headers: { host: 'api.example.com', 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
        body: null,
        isBase64Encoded: false,
      })

      expect(request.url).toBe('https://api.example.com/v1/ai/copilotkit')
      expect(request.method).toBe('POST')
      expect(request.headers.get('content-type')).toBe('application/json')
    })

    it('builds an absolute URL from a Function URL (v2) event', () => {
      const request = buildRequest({
        rawPath: '/v1/ai/copilotkit/agent/travelAiAgent/run',
        rawQueryString: 'a=1',
        headers: { host: 'fn.lambda-url.eu-west-1.on.aws' },
        requestContext: { http: { method: 'POST' } },
        body: '{}',
        isBase64Encoded: false,
      })

      expect(request.url).toBe('https://fn.lambda-url.eu-west-1.on.aws/v1/ai/copilotkit/agent/travelAiAgent/run?a=1')
      expect(request.method).toBe('POST')
    })

    it('appends v1 query string parameters when present', () => {
      const request = buildRequest({
        path: '/v1/ai/copilotkit',
        httpMethod: 'POST',
        headers: { host: 'api.example.com' },
        queryStringParameters: { a: '1', b: '2' },
      })

      expect(request.url).toBe('https://api.example.com/v1/ai/copilotkit?a=1&b=2')
    })

    it('passes a UTF-8 JSON body through for non-GET methods', async () => {
      const payload = JSON.stringify({ hello: 'world' })
      const request = buildRequest({ path: '/x', httpMethod: 'POST', headers: { host: 'h' }, body: payload })

      await expect(request.text()).resolves.toBe(payload)
    })

    it('decodes a base64-encoded body before forwarding', async () => {
      const payload = JSON.stringify({ binary: true })

      const request = buildRequest({
        path: '/x',
        httpMethod: 'POST',
        headers: { host: 'h' },
        body: Buffer.from(payload).toString('base64'),
        isBase64Encoded: true,
      })

      await expect(request.text()).resolves.toBe(payload)
    })

    it('omits the body entirely on GET requests', () => {
      const request = buildRequest({
        path: '/v1/ai/copilotkit/info',
        httpMethod: 'GET',
        headers: { host: 'h' },
        body: 'should-be-ignored',
      })

      expect(request.method).toBe('GET')
      expect(request.body).toBeNull()
    })
  })

  // The response is buffered through API Gateway, so a slow run is cut off by our
  // own watchdog rather than by API Gateway's opaque 504. These two helpers shape
  // what the browser receives in that case: every complete event that did arrive,
  // followed by a RUN_ERROR the AG-UI client can render.
  describe('truncateToLastCompleteFrame', () => {
    it('keeps whole frames and drops a trailing partial one', () => {
      const sse = 'data: {"type":"RUN_STARTED"}\n\ndata: {"type":"TEXT_MESSAGE_STA'

      expect(truncateToLastCompleteFrame(sse)).toBe('data: {"type":"RUN_STARTED"}\n\n')
    })

    it('preserves a body that already ends on a frame boundary', () => {
      const sse = 'data: {"a":1}\n\ndata: {"b":2}\n\n'

      expect(truncateToLastCompleteFrame(sse)).toBe(sse)
    })

    it('returns an empty string when no frame ever completed', () => {
      expect(truncateToLastCompleteFrame('data: {"partial"')).toBe('')
    })
  })

  // Regression: the runtime builds its SSE response from a TransformStream that is
  // written as TEXT, so draining it in-process yields strings — a real network
  // response yields Uint8Array. Passing a string to TextDecoder.decode throws
  // 'The "input" argument must be an instance of ArrayBuffer or ArrayBufferView',
  // which shipped as a 570 with no reply until an end-to-end run caught it.
  describe('decodeChunk', () => {
    it('passes a string chunk through unchanged (the in-process runtime case)', () => {
      const frame = 'data: {"type":"RUN_STARTED"}\n\n'

      expect(decodeChunk(frame, new TextDecoder())).toBe(frame)
    })

    it('decodes a Uint8Array chunk (the network-response case)', () => {
      const frame = 'data: {"type":"RUN_FINISHED"}\n\n'

      expect(decodeChunk(new TextEncoder().encode(frame), new TextDecoder())).toBe(frame)
    })

    it('decodes a multi-byte character split across two chunks', () => {
      const decoder = new TextDecoder()
      const bytes = new TextEncoder().encode('שלום')
      const first = decodeChunk(bytes.slice(0, 3), decoder)
      const second = decodeChunk(bytes.slice(3), decoder)

      expect(first + second).toBe('שלום')
    })
  })

  describe('buildRunErrorFrame', () => {
    it('emits a single parseable SSE frame carrying an AG-UI RUN_ERROR event', () => {
      const frame = buildRunErrorFrame('The assistant took too long to respond.')

      expect(frame.startsWith('data: ')).toBe(true)
      expect(frame.endsWith('\n\n')).toBe(true)

      const parsed = JSON.parse(frame.slice('data: '.length).trim())

      expect(parsed).toEqual({ type: 'RUN_ERROR', message: 'The assistant took too long to respond.' })
    })
  })
})
