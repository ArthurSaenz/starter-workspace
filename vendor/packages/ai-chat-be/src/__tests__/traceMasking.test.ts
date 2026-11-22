import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { maskTraceContent, scrubTraceText, scrubTraceValues, traceMaskingModeFor } from '../langgraph/traceMasking.js'

const MEMORY = 'Traveller is allergic to peanuts; reach me at arthur@example.com or +44 20 7946 0958'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXN0LTEifQ.c2lnbmF0dXJlLXZhbHVl'

interface ProcessingClient {
  processInputs: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>
  processOutputs: (outputs: Record<string, unknown>) => Promise<Record<string, unknown>>
}

describe('traceMaskingModeFor', () => {
  it('keeps text only for a dev or prod project; other stages and no project anonymize', () => {
    expect(traceMaskingModeFor('nomadream-ai-dev')).toBe('text')
    expect(traceMaskingModeFor('nomadream-ai-prod')).toBe('text')
    expect(traceMaskingModeFor('nomadream-ai-products')).toBe('anonymize')
    expect(traceMaskingModeFor('nomadream-ai-pr-42')).toBe('anonymize')
    expect(traceMaskingModeFor('nomadream-ai-devops')).toBe('anonymize')
    expect(traceMaskingModeFor(undefined)).toBe('anonymize')
  })
})

describe('scrubTraceText', () => {
  it.each([
    ['Write to arthur.s+trips@mail.example.co.uk.', 'Write to [email].'],
    ['Call +44 20 7946 0958 or (415) 555-0123 or 415-555-0123', 'Call [phone] or [phone] or [phone]'],
    ['Card 4111 1111 1111 1111 expires soon', 'Card [card] expires soon'],
    ['Card 4111111111111111', 'Card [card]'],
    ['Ref 4111 1111 1111 1112 failed Luhn', 'Ref [number] failed Luhn'],
    ['Passport 123456789 and member 9876543210', 'Passport [number] and member [number]'],
    ['Your confirmation number: 83KQ29XZ is ready', 'Your confirmation number: [booking-ref] is ready'],
    ['Booking ref ABCDEF at the Hyatt', 'Booking ref [booking-ref] at the Hyatt'],
    [`Cookie ${JWT}`, 'Cookie [jwt]'],
    ['Authorization: Bearer abc.def-ghi_123456', 'Authorization: Bearer [secret]'],
    ['key sk-ant-api03-abcdefghijklmnop1234 and lsv2_pt_0123456789abcdef0123', 'key [secret] and [secret]'],
    ['token a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8', 'token [secret]'],
    ['Call 050 123 4567 or 06 12 34 56 78', 'Call [phone] or [phone]'],
    ['Office (050) 123 45 67, ask for me', 'Office [phone], ask for me'],
    ['Amex 3782 822463 10005 on file', 'Amex [card] on file'],
    ['Passport 523456789X, member C01X00T47', 'Passport [number], member [number]'],
  ])('anonymizes %j', (text, expected) => {
    expect(scrubTraceText(text, 'anonymize')).toBe(expected)
  })

  it('keeps ordinary trip text readable', () => {
    const text =
      'A 4-night stay at the Hyatt Regency Bangkok from 2026-03-03 costs $1,240 (about 52,000 points); ' +
      'hotel 0b3c2f9e-6a1d-4c8b-9f2e-1d2c3b4a5f60, booking at the front desk.'

    expect(scrubTraceText(text, 'anonymize')).toBe(text)
  })

  it('keeps prices, dates, years and ids that look like grouped numbers', () => {
    const text =
      'Paid $1,234.50 (1 234 567 points) on 15.10.2026 for 2026-10-15 2026-10-20, seasons 2025-2026; ' +
      'hotel 550e8400-e29b-41d4-a716-446655440000, call call_01ABC234567, Room 1204, 4 nights.'

    expect(scrubTraceText(text, 'anonymize')).toBe(text)
  })

  it('in text mode masks secrets and keeps personal data', () => {
    expect(scrubTraceText(`${MEMORY}; session ${JWT}`, 'text')).toBe(`${MEMORY}; session [jwt]`)
  })
})

describe('scrubTraceValues', () => {
  it('keeps the message shape, roles, tool names and token counts, and anonymizes the text', () => {
    const scrubbed = scrubTraceValues(
      {
        messages: [
          [
            new HumanMessage(`Remember: ${MEMORY}`),
            new AIMessage({
              content: [{ type: 'text', text: 'Saving that.' }],
              tool_calls: [{ id: 'call-1', name: 'remember', args: { content: MEMORY, name: 'arthur@example.com' } }],
              usage_metadata: { input_tokens: 1200, output_tokens: 40, total_tokens: 1240 },
              // core 1.2 infers `usage_metadata` as `undefined` for the default message structure.
            } as unknown as ConstructorParameters<typeof AIMessage>[0]),
            new ToolMessage({ content: '{"saved":true}', tool_call_id: 'call-1', name: 'remember' }),
          ],
        ],
      },
      'anonymize',
    )

    const serialized = JSON.stringify(scrubbed)
    const anonymizedMemory = 'Traveller is allergic to peanuts; reach me at [email] or [phone]'

    expect(serialized).not.toContain('arthur@')
    expect(serialized).not.toContain('7946')
    expect(scrubbed).toMatchObject({
      messages: [
        [
          {
            type: 'constructor',
            id: ['langchain_core', 'messages', 'HumanMessage'],
            kwargs: { content: `Remember: ${anonymizedMemory}` },
          },
          {
            id: ['langchain_core', 'messages', 'AIMessage'],
            kwargs: {
              content: [{ type: 'text', text: 'Saving that.' }],
              tool_calls: [{ id: 'call-1', name: 'remember', args: { content: anonymizedMemory, name: '[email]' } }],
              usage_metadata: { input_tokens: 1200, output_tokens: 40, total_tokens: 1240 },
            },
          },
          { kwargs: { tool_call_id: 'call-1', name: 'remember', content: '{"saved":true}' } },
        ],
      ],
    })
  })

  it('keeps numbers and booleans and survives a cycle', () => {
    const cyclic: Record<string, unknown> = { answer: 'Mail a@b.io', nights: 4, ok: true, missing: null }

    Object.assign(cyclic, { self: cyclic })

    expect(scrubTraceValues(cyclic, 'anonymize')).toEqual({
      answer: 'Mail [email]',
      nights: 4,
      ok: true,
      missing: null,
      self: '[circular]',
    })
  })
})

describe('maskTraceContent', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Pins the @langchain/core + langsmith internals the masking relies on: the tracer's default client
  // is one shared instance, and it reads `hideInputs` / `hideOutputs` at send time.
  it("makes the tracer's shared LangSmith client send anonymized inputs and outputs on a preview stage", async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_PROJECT', 'nomadream-ai-pr-42')

    await maskTraceContent()

    const client = new LangChainTracer().client as unknown as ProcessingClient

    expect(await client.processInputs({ input: MEMORY })).toEqual({
      input: 'Traveller is allergic to peanuts; reach me at [email] or [phone]',
    })
    expect(await client.processOutputs({ output: 'Booked', tokens: 3 })).toEqual({ output: 'Booked', tokens: 3 })
  })

  it.each(['nomadream-ai-dev', 'nomadream-ai-prod'])('keeps the text on %s, still without secrets', async (project) => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_PROJECT', project)

    await maskTraceContent()

    const client = new LangChainTracer().client as unknown as ProcessingClient

    expect(await client.processInputs({ input: `${MEMORY} ${JWT}` })).toEqual({ input: `${MEMORY} [jwt]` })
  })

  // A client no host handed over (another @langchain/core install) is built after this and reads them.
  it('defaults langsmith to hiding inputs and outputs whole, even with tracing off', async () => {
    vi.stubEnv('LANGSMITH_TRACING', undefined)
    vi.stubEnv('LANGSMITH_HIDE_INPUTS', undefined)
    vi.stubEnv('LANGSMITH_HIDE_OUTPUTS', undefined)

    await maskTraceContent()

    expect(process.env).toMatchObject({ LANGSMITH_HIDE_INPUTS: 'true', LANGSMITH_HIDE_OUTPUTS: 'true' })
  })
})
