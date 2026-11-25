/* eslint-disable node/prefer-global/process */

// Provider/model resolution, kept free of any LangChain import so the Lambda can label a
// response with the active model without pulling in the graph: `lambda/copilotkit.ts` imports
// `graph/index.ts` dynamically on purpose, so a rejected request never pays its cold start.

// Every provider stays wired so `LLM_PROVIDER` can flip between them without a code change.
export const LLM_PROVIDERS = {
  deepseek: 'deepseek',
  gemini: 'gemini',
  anthropic: 'anthropic',
} as const

export type LlmProvider = keyof typeof LLM_PROVIDERS

export const DEFAULT_MODEL_IDS: Record<LlmProvider, string> = {
  deepseek: 'deepseek-flash',
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-opus-5-5',
}

// Reported in place of a model id when the configured provider has no defaults to read.
const UNKNOWN_MODEL_ID = 'unknown'

const isLlmProvider = (value: string): value is LlmProvider => {
  return value in LLM_PROVIDERS
}

// Reported in place of a provider in the response label when LLM_PROVIDER is unset or empty.
const UNSET_PROVIDER = 'unset'

const readConfiguredProvider = (): string => {
  // eslint-disable-next-line dot-notation
  return process.env['LLM_PROVIDER'] ?? ''
}

// No default provider: a missing LLM_PROVIDER once sent every request to Anthropic silently.
export const readLlmProvider = (): LlmProvider => {
  const configured = readConfiguredProvider()

  if (configured === '') {
    throw new Error(`LLM_PROVIDER is not set; expected one of ${Object.keys(LLM_PROVIDERS).join(', ')}`)
  }

  if (!isLlmProvider(configured)) {
    throw new Error(`Unknown LLM_PROVIDER "${configured}"; expected one of ${Object.keys(LLM_PROVIDERS).join(', ')}`)
  }

  return configured
}

export const readModelId = (provider: LlmProvider): string => {
  // eslint-disable-next-line dot-notation
  return process.env['LANGGRAPH_MODEL_ID'] || DEFAULT_MODEL_IDS[provider]
}

// `<provider>/<modelId>`, e.g. `anthropic/claude-opus-5-5`. Never throws: an unset or
// unrecognised LLM_PROVIDER already fails `readLlmProvider` where the graph resolves its model,
// and labelling a response must not turn a route rejection into a 500 — the raw configured value
// (or `unset`) is reported instead. Read per call rather than at module load so the label
// follows a redeployed environment.
export const modelIdentityLabel = (): string => {
  const configured = readConfiguredProvider()
  const fallback = isLlmProvider(configured) ? DEFAULT_MODEL_IDS[configured] : UNKNOWN_MODEL_ID
  // eslint-disable-next-line dot-notation
  const modelId = process.env['LANGGRAPH_MODEL_ID'] || fallback

  return `${configured || UNSET_PROVIDER}/${modelId}`
}
