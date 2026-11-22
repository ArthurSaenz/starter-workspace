import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GeminiTranscriptionService,
  MAX_AUDIO_BYTES,
  TRANSCRIPTION_ERRORS,
  isTranscriptionConfigured,
} from '../transcription/geminiTranscription.js'
import type { FetchLike } from '../transcription/geminiTranscription.js'

const audio = (bytes = 64, type = 'audio/webm;codecs=opus'): File => {
  return new File([new Uint8Array(bytes)], 'recording.webm', { type })
}

const transcribe = (service: GeminiTranscriptionService, file: File) => {
  return service.transcribeFile({ audioFile: file, mimeType: file.type, size: file.size })
}

const replying = (status: number, body: unknown) => {
  return vi.fn<FetchLike>(async () => {
    return new Response(JSON.stringify(body), { status })
  })
}

const geminiText = (text: string) => {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

describe('geminiTranscriptionService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends the audio inline with the key in a header, never the URL, and returns the trimmed text', async () => {
    const fetch = replying(200, geminiText('  Which Bangkok hotels are on World of Hyatt?\n'))
    const service = new GeminiTranscriptionService({ apiKey: 'test-key', modelId: 'gemini-2.5-flash', fetch })

    expect(await transcribe(service, audio())).toBe('Which Bangkok hotels are on World of Hyatt?')

    const [url, init] = fetch.mock.calls[0] ?? []

    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<{ inline_data?: { mime_type: string; data: string } }> }>
      generationConfig: { temperature: number }
    }

    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(url).not.toContain('test-key')
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
    // Codec parameters are not part of the MIME type the provider accepts.
    expect(body.contents[0]?.parts[1]?.inline_data?.mime_type).toBe('audio/webm')
    expect(body.contents[0]?.parts[1]?.inline_data?.data).toBe(Buffer.from(new Uint8Array(64)).toString('base64'))
    expect(body.generationConfig.temperature).toBe(0)
  })

  it('refuses a recording over the budget before calling the provider', async () => {
    const fetch = replying(200, geminiText('unused'))
    const service = new GeminiTranscriptionService({ apiKey: 'k', fetch })

    await expect(transcribe(service, audio(MAX_AUDIO_BYTES + 1))).rejects.toThrow(TRANSCRIPTION_ERRORS.tooLong)
    expect(fetch).not.toHaveBeenCalled()
  })

  // The runtime copies the thrown message into the response the browser shows and picks the
  // status from its wording, so each failure must be one of the fixed messages.
  it.each([
    [429, TRANSCRIPTION_ERRORS.rateLimited],
    [403, TRANSCRIPTION_ERRORS.auth],
    [400, TRANSCRIPTION_ERRORS.failed],
    [500, TRANSCRIPTION_ERRORS.failed],
  ])('maps a provider %i to a fixed message, never the provider text', async (status, message) => {
    const fetch = replying(status, { error: { message: 'API key AIza-secret quota project 1234' } })
    const service = new GeminiTranscriptionService({ apiKey: 'k', fetch })

    await expect(transcribe(service, audio())).rejects.toThrow(message)
  })

  it('maps a network failure to the fixed failure message', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com')
    })

    const service = new GeminiTranscriptionService({ apiKey: 'k', fetch })

    await expect(transcribe(service, audio())).rejects.toThrow(TRANSCRIPTION_ERRORS.failed)
  })

  it('reports itself unconfigured, and fails closed, without a key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')

    expect(isTranscriptionConfigured()).toBe(false)
    await expect(transcribe(new GeminiTranscriptionService(), audio())).rejects.toThrow(TRANSCRIPTION_ERRORS.auth)
  })

  it('returns an empty transcript when the provider hears nothing', async () => {
    const service = new GeminiTranscriptionService({ apiKey: 'k', fetch: replying(200, { candidates: [] }) })

    expect(await transcribe(service, audio())).toBe('')
  })
})
