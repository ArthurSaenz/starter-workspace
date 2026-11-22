/* eslint-disable node/prefer-global/process */
import { TranscriptionService } from '@copilotkit/runtime/v2'
import type { TranscribeFileOptions } from '@copilotkit/runtime/v2'
import { Buffer } from 'node:buffer'

import { consoleJsonLogger } from '../ports.js'
import type { ChatLogger, ChatLoggerFactory } from '../ports.js'

const DEFAULT_MODEL_ID = 'gemini-2.5-flash'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

// The Lambda already refuses a body over 512 KB (copilotkit.ts), which as base64 multipart leaves
// roughly 380 KB of audio — a little over a minute of Opus at the bitrate browsers record. The
// cap here is the same budget stated in bytes of audio, so a direct caller gets the same answer.
export const MAX_AUDIO_BYTES = 380 * 1024
const MAX_TRANSCRIPT_TOKENS = 1024

const PROMPT = [
  'Transcribe this voice message from a traveller to a travel assistant.',
  'Return only the words spoken, in the language spoken, with normal punctuation.',
  'Do not answer the message, translate it, or add anything. If nothing intelligible is said, return an empty string.',
].join(' ')

// The runtime classifies a thrown error by its text (handle-transcribe `categorizeProviderError`)
// AND copies the message into the response the browser shows. So the provider's own wording
// never leaves this module: each failure becomes a fixed message the classifier maps to the right
// status (429 / 401 / 400 / 500), and the raw one goes to the logs.
export const TRANSCRIPTION_ERRORS = {
  rateLimited: 'Too many requests: rate limited, try again shortly',
  auth: 'Transcription is unavailable: unauthorized',
  tooLong: 'The recording is too long',
  failed: 'The recording could not be transcribed',
} as const

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface GeminiTranscriptionOptions {
  apiKey?: string
  modelId?: string
  fetch?: FetchLike
  createLogger?: ChatLoggerFactory
}

export const isTranscriptionConfigured = (): boolean => {
  // eslint-disable-next-line dot-notation
  return Boolean(process.env['GEMINI_API_KEY'])
}

const failureFor = (status: number): string => {
  if (status === 429) return TRANSCRIPTION_ERRORS.rateLimited
  if (status === 401 || status === 403) return TRANSCRIPTION_ERRORS.auth

  return TRANSCRIPTION_ERRORS.failed
}

/** Speech-to-text on the Gemini key the chat already holds: one `generateContent` call with the audio inline. */
export class GeminiTranscriptionService extends TranscriptionService {
  private readonly apiKey: string | undefined
  private readonly modelId: string
  private readonly fetchImpl: FetchLike
  private readonly logger: ChatLogger

  constructor(options: GeminiTranscriptionOptions = {}) {
    super()
    this.logger = (options.createLogger ?? consoleJsonLogger)('geminiTranscription')
    // eslint-disable-next-line dot-notation
    this.apiKey = options.apiKey ?? process.env['GEMINI_API_KEY']
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID
    // Resolved per call, not captured here, so the global the Lambda (or a test) has at request
    // time is the one used.
    this.fetchImpl =
      options.fetch ??
      (async (input, init) => {
        return fetch(input, init)
      })
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    const { audioFile } = options

    if (!this.apiKey) throw new Error(TRANSCRIPTION_ERRORS.auth)
    if (audioFile.size > MAX_AUDIO_BYTES) throw new Error(TRANSCRIPTION_ERRORS.tooLong)

    // Codec parameters (`audio/webm;codecs=opus`) are not part of the MIME type Gemini takes.
    const mimeType = (options.mimeType ?? audioFile.type).split(';')[0]?.trim() || 'audio/webm'
    const data = Buffer.from(await audioFile.arrayBuffer()).toString('base64')

    let response: Response

    try {
      response = await this.fetchImpl(`${ENDPOINT}/${encodeURIComponent(this.modelId)}:generateContent`, {
        method: 'POST',
        // A header, not `?key=`: a query string is what ends up in access logs.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: MAX_TRANSCRIPT_TOKENS },
        }),
      })
    } catch (error) {
      this.logger.error('transcription request failed', {
        rawMessage: error instanceof Error ? error.message : String(error),
      })
      throw new Error(TRANSCRIPTION_ERRORS.failed)
    }

    if (!response.ok) {
      this.logger.error('transcription rejected by the provider', {
        status: response.status,
        rawBody: (await response.text()).slice(0, 500),
        mimeType,
        bytes: audioFile.size,
      })
      throw new Error(failureFor(response.status))
    }

    const body = (await response.json()) as GenerateContentResponse
    const parts = body.candidates?.[0]?.content?.parts ?? []

    return parts
      .map((part) => {
        return part.text ?? ''
      })
      .join('')
      .trim()
  }
}
