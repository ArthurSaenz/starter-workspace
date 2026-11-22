// The one model price table: the daily budget (`./usage`), the `ai_cost_daily` view (lib-db migration
// 0104, kept equal by usage.costView.test.ts) and the eval report all price tokens with it.
//
// Every weight is relative to plain (uncached) input of the same model, and each model's input is a
// fraction of Opus 5.5's ($4 / MTok). List prices, per MTok:
//   Opus 5.5   $4 in, $20 out, cache read $0.20
//   Sonnet 5.5 $2 in, $10 out, cache read $0.20
//   Haiku 5.5  $0.10 in, $0.50 out, cache read $0.01
//   Fable      $10 in, $50 out, cache read $0.25
// Cache writes cost 1.25× input with the 5-minute TTL and 2× with the 1-hour one, on every model.

/** Opus 5.5 input list price, the unit every weight is relative to. */
export const OPUS_INPUT_USD_PER_MTOK = 4

// Every family prices output at five times its input.
export const OUTPUT_TOKEN_WEIGHT = 5
export const CACHE_WRITE_5M_WEIGHT = 1.25
export const CACHE_WRITE_1H_WEIGHT = 2

// Each family's input list price over Opus 5.5's (Haiku 4.5: $1 in). First match wins, so the older
// Haiku is tried before the family. A model not listed (the
// `unknown` row, DeepSeek, Gemini) weighs as Opus: over-counting only refuses a run sooner.
// A `price:<source>` row is a paid price call already written as Opus-input tokens, so it weighs 1;
// it is tried first so a source id that happens to contain a family name cannot reweigh it.
export const MODEL_PRICE_WEIGHTS: readonly (readonly [RegExp, number])[] = [
  [/^price:/, 1],
  [/haiku-4/, 0.25],
  [/haiku/, 0.025],
  [/sonnet/, 0.5],
  [/opus/, 1],
  [/fable|mythos/, 2.5],
]

// A cache read over the same model's input: Opus 5.5 discounts reads further than the others.
export const CACHE_READ_WEIGHTS: readonly (readonly [RegExp, number])[] = [
  [/opus/, 0.05],
  [/sonnet/, 0.1],
  [/haiku/, 0.1],
  [/fable|mythos/, 0.025],
]
export const DEFAULT_CACHE_READ_WEIGHT = 0.1

const firstMatch = (table: readonly (readonly [RegExp, number])[], model: string): number | undefined => {
  return table.find(([pattern]) => {
    return pattern.test(model)
  })?.[1]
}

export const modelPriceWeight = (model: string): number => {
  return firstMatch(MODEL_PRICE_WEIGHTS, model) ?? 1
}

export const cacheReadWeight = (model: string): number => {
  return firstMatch(CACHE_READ_WEIGHTS, model) ?? DEFAULT_CACHE_READ_WEIGHT
}

/** One model's tokens by meter; `inputTokens` is uncached input only, so no meter double counts. */
export interface MeteredTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
}

/** The tokens as Opus-5.5-input-equivalent tokens: each meter at its rate, the model at its price. */
export const opusEquivalentTokens = (model: string, tokens: MeteredTokens): number => {
  return (
    modelPriceWeight(model) *
    (tokens.inputTokens +
      cacheReadWeight(model) * tokens.cacheReadTokens +
      CACHE_WRITE_5M_WEIGHT * tokens.cacheWrite5mTokens +
      CACHE_WRITE_1H_WEIGHT * tokens.cacheWrite1hTokens +
      OUTPUT_TOKEN_WEIGHT * tokens.outputTokens)
  )
}
