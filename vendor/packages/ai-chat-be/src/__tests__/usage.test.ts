import { describe, expect, it } from 'vitest'

import { cacheReadWeight, modelPriceWeight } from '../lambda/pricing.js'
import { weightedTokens } from '../lambda/usage.js'
import type { UsageModelTotal } from '../ports.js'

describe('modelPriceWeight', () => {
  it('weighs a price source call at the Opus price it was converted at', () => {
    expect(modelPriceWeight('price:liteapi')).toBe(1)
  })

  it('keeps a price row at 1 even when its source id names a cheaper family', () => {
    expect(modelPriceWeight('price:haiku-hotels')).toBe(1)
  })

  it('still weighs model rows by family', () => {
    expect(modelPriceWeight('claude-haiku-4-5')).toBe(0.25)
    expect(modelPriceWeight('claude-sonnet-5-5')).toBe(0.5)
  })
})

describe('cacheReadWeight', () => {
  it('prices a cache read per model, 0.1× input when the model is not listed', () => {
    expect(cacheReadWeight('claude-opus-5-5')).toBeCloseTo(0.05, 10)
    expect(cacheReadWeight('claude-sonnet-5-5')).toBeCloseTo(0.1, 10)
    expect(cacheReadWeight('claude-haiku-5-5')).toBeCloseTo(0.1, 10)
    expect(cacheReadWeight('claude-fable-5')).toBeCloseTo(0.025, 10)
    expect(cacheReadWeight('deepseek-chat')).toBeCloseTo(0.1, 10)
  })
})

const row = (model: string, counts: Partial<UsageModelTotal>): UsageModelTotal => {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: null,
    ...counts,
  }
}

const weigh = (...byModel: UsageModelTotal[]): number => {
  return weightedTokens({ byModel })
}

describe('weightedTokens', () => {
  it('weighs Opus reads at 0.05× and Sonnet reads at 0.1× of their own input', () => {
    expect(weigh(row('claude-opus-5-5', { cacheReadTokens: 1_000_000 }))).toBe(50_000)
    expect(weigh(row('claude-sonnet-5-5', { cacheReadTokens: 1_000_000 }))).toBe(50_000)
    expect(weigh(row('claude-haiku-5-5', { cacheReadTokens: 1_000_000 }))).toBeCloseTo(2500)
    expect(weigh(row('claude-fable-5', { cacheReadTokens: 1_000_000 }))).toBe(62_500)
  })

  it('weighs 5-minute writes at 1.25× and the 1-hour subset at 2×', () => {
    expect(weigh(row('claude-opus-5-5', { cacheCreationTokens: 1000, cacheCreation1hTokens: 0 }))).toBe(1250)
    expect(weigh(row('claude-opus-5-5', { cacheCreationTokens: 1000, cacheCreation1hTokens: 1000 }))).toBe(2000)
    expect(weigh(row('claude-opus-5-5', { cacheCreationTokens: 1000, cacheCreation1hTokens: 400 }))).toBe(1550)
  })

  it('prices every write of a row from before the 1-hour column at 5 minutes', () => {
    expect(weigh(row('claude-opus-5-5', { cacheCreationTokens: 1000, cacheCreation1hTokens: null }))).toBe(1250)
  })

  it('weighs output at 5× and sums rows across models', () => {
    expect(
      weigh(
        row('claude-opus-5-5', { inputTokens: 100, outputTokens: 10 }),
        row('claude-sonnet-5-5', { inputTokens: 100 }),
      ),
    ).toBe(200)
  })
})
