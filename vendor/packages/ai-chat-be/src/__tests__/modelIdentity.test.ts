import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MODEL_IDS,
  LLM_PROVIDERS,
  modelIdentityLabel,
  readLlmProvider,
  readModelId,
} from '../langgraph/modelIdentity.js'

// The provider/model resolution the graph and the Lambda's response label share. Read per
// call, so unlike `graph/index.ts` these need no module reset between env stubs.
describe('modelIdentity', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves Anthropic to claude-opus-5-5', () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LANGGRAPH_MODEL_ID', undefined)

    expect(readLlmProvider()).toBe('anthropic')
    expect(readModelId(readLlmProvider())).toBe('claude-opus-5-5')
    expect(modelIdentityLabel()).toBe('anthropic/claude-opus-5-5')
  })

  it.each([undefined, ''])('fails fast on LLM_PROVIDER=%j instead of picking a provider', (value) => {
    vi.stubEnv('LLM_PROVIDER', value)

    expect(() => {
      return readLlmProvider()
    }).toThrow('LLM_PROVIDER is not set; expected one of deepseek, gemini, anthropic')
  })

  it.each([undefined, ''])('labels LLM_PROVIDER=%j as unset instead of throwing', (value) => {
    vi.stubEnv('LLM_PROVIDER', value)
    vi.stubEnv('LANGGRAPH_MODEL_ID', undefined)

    expect(modelIdentityLabel()).toBe('unset/unknown')
  })

  it('follows LLM_PROVIDER to the other provider default', () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('LANGGRAPH_MODEL_ID', undefined)

    expect(readLlmProvider()).toBe('gemini')
    expect(modelIdentityLabel()).toBe('gemini/gemini-2.5-flash')
  })

  it('lets LANGGRAPH_MODEL_ID override the active provider default', () => {
    vi.stubEnv('LLM_PROVIDER', 'deepseek')
    vi.stubEnv('LANGGRAPH_MODEL_ID', 'deepseek-v4-pro')

    expect(readModelId('deepseek')).toBe('deepseek-v4-pro')
    expect(modelIdentityLabel()).toBe('deepseek/deepseek-v4-pro')
  })

  it('fails fast on an unknown provider', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')

    expect(() => {
      return readLlmProvider()
    }).toThrow(/Unknown LLM_PROVIDER "openai"/)
  })

  // The graph refuses to load under a bad provider; the response label must still answer.
  it('labels an unknown provider instead of throwing', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('LANGGRAPH_MODEL_ID', undefined)

    expect(modelIdentityLabel()).toBe('openai/unknown')
  })

  it('keeps both providers wired with a default each', () => {
    expect(Object.keys(LLM_PROVIDERS)).toEqual(Object.keys(DEFAULT_MODEL_IDS))
  })
})
