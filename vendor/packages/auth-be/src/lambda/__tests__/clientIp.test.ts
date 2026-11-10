/* eslint-disable sonarjs/no-hardcoded-ip -- fixture client IPs */
import { describe, expect, it, vi } from 'vitest'

import { createClientIpResolver, extractSourceIp, extractUserAgent } from '../clientIp.js'

const eventOf = (xff: string | undefined, sourceIp: string | undefined) => {
  return {
    ...(xff ? { headers: { 'X-Forwarded-For': xff } } : {}),
    ...(sourceIp ? { requestContext: { identity: { sourceIp } } } : {}),
  }
}

describe('extractSourceIp', () => {
  it.each<[{ xff?: string; sourceIp?: string; hops?: number }, string]>([
    [{ xff: '6.6.6.6', sourceIp: '9.9.9.9', hops: 0 }, '9.9.9.9'],
    [{ xff: '6.6.6.6', sourceIp: '9.9.9.9' }, '9.9.9.9'],
    [{ xff: '6.6.6.6, 1.2.3.4', hops: 1 }, '1.2.3.4'],
    [{ xff: '6.6.6.6 , 1.2.3.4 ,, 10.0.0.1', hops: 2 }, '1.2.3.4'],
    [{ xff: '1.2.3.4', sourceIp: '9.9.9.9', hops: 2 }, '9.9.9.9'],
    [{ sourceIp: ' 9.9.9.9 ', hops: 1 }, '9.9.9.9'],
    [{}, ''],
  ])('%o → %s', ({ xff, sourceIp, hops }, expected) => {
    expect(extractSourceIp(eventOf(xff, sourceIp), hops)).toBe(expected)
  })
})

describe('extractUserAgent', () => {
  it('reads the header, or answers an empty string', () => {
    expect(extractUserAgent({ headers: { 'User-Agent': 'vitest' } })).toBe('vitest')
    expect(extractUserAgent({})).toBe('')
  })
})

describe('createClientIpResolver', () => {
  it.each([undefined, {}, { trustedProxyHops: -1 }, { trustedProxyHops: 1.5 }, { trustedProxyHops: '1' }])(
    'refuses %j at construction',
    (options) => {
      expect(() => {
        return createClientIpResolver(options as never)
      }).toThrow('auth: clientIp.trustedProxyHops must be a non-negative integer')
    },
  )

  it('reads the trusted hop and never warns about it', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const clientIp = createClientIpResolver({ trustedProxyHops: 1 })

    expect(clientIp(eventOf('6.6.6.6, 1.2.3.4', '9.9.9.9'), { logger })).toBe('1.2.3.4')
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
