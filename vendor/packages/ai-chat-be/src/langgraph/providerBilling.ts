// A top-level key of the JSON log line: a CloudWatch metric filter counts `$.metric = "provider_credit_exhausted"`
// and alarms on the first one, so the value is a contract, not wording.
export const PROVIDER_CREDIT_EXHAUSTED_METRIC = 'provider_credit_exhausted'

// Anthropic answers a drained prepaid balance with a 400 `invalid_request_error` whose only tell is
// this sentence; `billing_error` (402) and `permission_error` (403) are its documented account-level
// refusals (https://docs.anthropic.com/en/api/errors). None clears on a retry, and every model of the
// same org answers alike.
const CREDIT_EXHAUSTED_TEXT = /credit balance is too low/iu
const BILLING_ERROR_TYPES: ReadonlySet<string> = new Set(['billing_error', 'permission_error'])
const BILLING_ERROR_TYPE_IN_TEXT = /"type"\s*:\s*"(?:billing_error|permission_error)"/u
const PAYMENT_REQUIRED = 402

interface ProviderErrorShape {
  message?: unknown
  status?: unknown
  error?: { type?: unknown; error?: { type?: unknown } }
  cause?: unknown
}

const isBillingShape = (err: ProviderErrorShape): boolean => {
  const message = typeof err.message === 'string' ? err.message : ''
  // The Anthropic SDK keeps the response body on `.error`; LangChain's wrapper keeps only the message,
  // which still carries that body as JSON.
  const bodyType = err.error?.error?.type ?? err.error?.type

  return (
    CREDIT_EXHAUSTED_TEXT.test(message) ||
    BILLING_ERROR_TYPE_IN_TEXT.test(message) ||
    (typeof bodyType === 'string' && BILLING_ERROR_TYPES.has(bodyType)) ||
    err.status === PAYMENT_REQUIRED
  )
}

/**
 * Whether a model call failed because the provider account cannot pay (credit exhausted, billing or
 * permission refused). Such a call is not retried, not handed to another model of the same provider,
 * and not worth a "try again" — only an operator topping up or fixing the account lifts it.
 */
export const isProviderBillingError = (err: unknown): boolean => {
  let current: unknown = err

  // A wrapper (LangGraph, LangChain) may hold the provider error as its cause.
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if (isBillingShape(current as ProviderErrorShape)) return true
    current = (current as ProviderErrorShape).cause
  }

  return false
}
