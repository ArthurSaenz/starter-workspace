import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { describe, expect, it, vi } from 'vitest'

import {
  assistantReasoningOf,
  fetchWithReasoningReplay,
  replayReasoningContent,
} from '../langgraph/deepseekReasoning.js'

describe('deepSeek reasoning replay', () => {
  it('lists one reasoning entry per assistant message, empty where none was recorded', () => {
    expect(
      assistantReasoningOf([
        new HumanMessage('hi'),
        new AIMessage({ content: '', additional_kwargs: { reasoning_content: 'first' } }),
        new ToolMessage({ content: '{}', tool_call_id: 'c1' }),
        new AIMessage('no reasoning'),
      ]),
    ).toEqual(['first', ''])
  })

  it('puts each reasoning back on its assistant message in order and fills the rest with an empty string', () => {
    const body = JSON.stringify({
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', tool_calls: [] },
        { role: 'tool', content: '{}', tool_call_id: 'c1' },
        { role: 'assistant', content: 'done' },
      ],
    })

    const replayed = JSON.parse(replayReasoningContent(body, ['first'])) as {
      messages: Array<Record<string, unknown>>
    }

    expect(replayed.messages[2]).toMatchObject({ reasoning_content: 'first' })
    expect(replayed.messages[4]).toMatchObject({ reasoning_content: '' })
    expect(replayed.messages[1]).not.toHaveProperty('reasoning_content')
  })

  it('passes a body it cannot read through unchanged', () => {
    expect(replayReasoningContent('not json', ['x'])).toBe('not json')
    expect(replayReasoningContent('{"input":"x"}', ['x'])).toBe('{"input":"x"}')
  })

  it('rewrites only string bodies on the wire', async () => {
    const baseFetch = vi.fn(async (_input: unknown, _init?: RequestInit) => {
      return new Response('{}')
    })

    const replayingFetch = fetchWithReasoningReplay(['why'], baseFetch as unknown as typeof fetch)

    await replayingFetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'assistant', content: 'a' }] }),
    })
    await replayingFetch('https://api.deepseek.com/models', { method: 'GET' })

    const sentBody = String(baseFetch.mock.calls[0]?.[1]?.body)

    expect(JSON.parse(sentBody)).toEqual({ messages: [{ role: 'assistant', content: 'a', reasoning_content: 'why' }] })
    expect(baseFetch.mock.calls[1]?.[1]).toEqual({ method: 'GET' })
  })
})
