import { describe, expect, it } from 'vitest'

import { defaultIsAllowed, defaultRolesOf } from '../config.js'

const user = { id: 'u1', email: 'ada@example.com' }

describe('config defaults', () => {
  it.each([
    [{ ...user, invited: true }, true],
    [{ ...user, invited: false }, false],
    [{ ...user, invited: null }, false],
    [user, false],
  ])('allows only an explicitly invited user: %j → %s', (row, allowed) => {
    expect(defaultIsAllowed(row)).toBe(allowed)
  })

  it('reads the roles claim from the row, empty when it has none', () => {
    expect(defaultRolesOf({ ...user, roles: ['admin'] })).toEqual(['admin'])
    expect(defaultRolesOf({ ...user, roles: null })).toEqual([])
    expect(defaultRolesOf(user)).toEqual([])
  })
})
