import { describe, expect, it } from 'vitest'

import { AI_CHAT_RUNTIME_URL } from '../runtime-url.js'

// Same-origin contract: CloudFront's `/api/v1*` behaviour is the only path that forwards the
// session cookie to the ai-api Lambda (devops/terraform/infrastructure/src/cloudfront/website.tf).
describe('runtime url', () => {
  it('stays under the /api/v1/ai prefix', () => {
    expect(AI_CHAT_RUNTIME_URL.startsWith('/api/v1/ai/')).toBe(true)
  })
})
