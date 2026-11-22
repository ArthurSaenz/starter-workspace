import { describe, expect, it } from 'vitest'

import { isProviderBillingError } from '../langgraph/providerBilling.js'

const CREDIT_EXHAUSTED =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'

describe('isProviderBillingError', () => {
  it('recognises the exhausted-credit 400 by its message', () => {
    expect(isProviderBillingError(new Error(CREDIT_EXHAUSTED))).toBe(true)
  })

  it('recognises billing_error and permission_error bodies, on the SDK error or in the message', () => {
    const sdkError = Object.assign(new Error('402 billing'), {
      status: 402,
      error: { type: 'error', error: { type: 'billing_error', message: 'payment method declined' } },
    })

    expect(isProviderBillingError(sdkError)).toBe(true)
    expect(isProviderBillingError(new Error('403 {"type":"error","error":{"type":"permission_error"}}'))).toBe(true)
  })

  it('looks through a wrapper to its cause', () => {
    expect(isProviderBillingError(new Error('node failed', { cause: new Error(CREDIT_EXHAUSTED) }))).toBe(true)
  })

  it('leaves retryable and ordinary request failures alone', () => {
    const overloaded = Object.assign(new Error('529 {"type":"error","error":{"type":"overloaded_error"}}'), {
      status: 529,
    })

    const badRequest = Object.assign(
      new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens too large"}}'),
      { status: 400 },
    )

    expect(isProviderBillingError(overloaded)).toBe(false)
    expect(isProviderBillingError(badRequest)).toBe(false)
    expect(isProviderBillingError(new Error('no model output within 40000ms'))).toBe(false)
    expect(isProviderBillingError(undefined)).toBe(false)
  })
})
