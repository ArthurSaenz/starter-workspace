// A vote reaches LangSmith on the trace of the turn that wrote the answer, only with tracing on, and
// never at the cost of the vote itself.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { settleBackgroundWrites } from '../tools/backgroundWrites.js'
import { MemoryStorage } from './helpers/memory-storage.js'

const langsmith = vi.hoisted(() => {
  return { createFeedback: vi.fn(async () => {}) }
})

vi.mock('@langchain/core/tracers/tracer_langchain', () => {
  return {
    LangChainTracer: class {
      client = { createFeedback: langsmith.createFeedback }
    },
  }
})

const { LANGSMITH_FEEDBACK_KEY, storeFeedback } = await import('../lambda/feedback.js')

const storage = new MemoryStorage()
const OWNER = 'fb-ls-owner'
const TRACE = '0f8fad5b-d9cb-469f-a165-70867728950e'

const vote = async (body: Record<string, unknown>) => {
  const outcome = await storeFeedback(OWNER, JSON.stringify({ threadId: 'chat-1', ...body }), {
    history: storage.history,
    dropConnections: () => {
      storage.dropConnections()
    },
  })

  await settleBackgroundWrites(1000)

  return outcome
}

const ratingOf = (messageId: string) => {
  return storage.ratings.get(`${OWNER}:${messageId}`)
}

describe('feedback to LangSmith', () => {
  beforeAll(() => {
    storage.keepChat({
      id: 'chat-1',
      customerId: OWNER,
      title: 'T',
      messages: [{ id: 'a1', role: 'assistant', content: 'Hi' }],
      traceRunIds: { a1: TRACE },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    langsmith.createFeedback.mockClear()
  })

  it('files a thumbs-down with its reason on the trace that wrote the answer', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')

    expect(await vote({ messageId: 'a1', rating: 'down', reason: 'Wrong city' })).toBe('stored')
    expect(langsmith.createFeedback).toHaveBeenCalledWith(TRACE, LANGSMITH_FEEDBACK_KEY, {
      score: 0,
      comment: 'Wrong city',
    })
  })

  // The reason is the traveller's own words: it leaves masked like the trace text beside it.
  it('masks personal data in the reason before it reaches LangSmith, and keeps it whole in the database', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_PROJECT', 'nomadream-ai-pr-42')

    const reason = 'Wrong hotel, mail me at jane.doe@example.com'

    await vote({ messageId: 'a1', rating: 'down', reason })

    const { comment } = (langsmith.createFeedback.mock.calls as unknown as unknown[][])[0]?.[2] as { comment: string }

    expect(comment).toContain('Wrong hotel')
    expect(comment).not.toContain('jane.doe@example.com')
    expect(ratingOf('a1')?.reason).toBe(reason)
  })

  it('scores a thumbs-up 1, without a comment', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')

    await vote({ messageId: 'a1', rating: 'up' })

    expect(langsmith.createFeedback).toHaveBeenCalledWith(TRACE, LANGSMITH_FEEDBACK_KEY, { score: 1 })
  })

  it('sends nothing with tracing off, or for a message with no trace', async () => {
    await vote({ messageId: 'a1', rating: 'up' })
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    await vote({ messageId: 'unknown', rating: 'up' })

    expect(langsmith.createFeedback).not.toHaveBeenCalled()
  })

  it('keeps the vote when LangSmith refuses it', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    langsmith.createFeedback.mockRejectedValueOnce(new Error('LangSmith down'))

    expect(await vote({ messageId: 'a1', rating: 'down' })).toBe('stored')
    expect(ratingOf('a1')).toMatchObject({ rating: 'down' })
  })
})
