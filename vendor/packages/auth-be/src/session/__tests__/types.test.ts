/* eslint-disable sonarjs/no-hardcoded-ip -- fixture client IPs */
import { describe, expect, it } from 'vitest'

import { withMeta } from '../types.js'

describe('withMeta', () => {
  it.each([
    [undefined, {}],
    [{}, {}],
    [{ ipAddress: null, userAgent: null }, {}],
    [{ ipAddress: '', userAgent: '' }, {}],
    [{ ipAddress: '1.2.3.4' }, { ipAddress: '1.2.3.4' }],
    [{ userAgent: 'vitest' }, { userAgent: 'vitest' }],
    [
      { ipAddress: '1.2.3.4', userAgent: 'vitest' },
      { ipAddress: '1.2.3.4', userAgent: 'vitest' },
    ],
  ])('%j → %j', (meta, expected) => {
    expect(withMeta(meta)).toEqual(expected)
  })
})
