import { describe, expect, it } from 'vitest'

import {
  buildAccessCookie,
  buildClearCookies,
  buildRefreshCookie,
  extractAccessToken,
  extractRefreshToken,
  parseCookieHeader,
  resolveCookieOptions,
} from '../cookies.js'

describe('resolveCookieOptions', () => {
  it('defaults every name and path', () => {
    expect(resolveCookieOptions()).toEqual({
      accessName: 'access_token',
      refreshName: 'refresh_token',
      accessPath: '/',
      refreshPath: '/api/v1/auth',
    })
  })

  it('keeps the defaults a partial override leaves out', () => {
    expect(resolveCookieOptions({ refreshPath: '/auth' })).toMatchObject({
      refreshName: 'refresh_token',
      refreshPath: '/auth',
    })
  })
})

describe('building cookies', () => {
  const cookies = resolveCookieOptions({ accessName: 'sid', refreshName: 'rid', refreshPath: '/auth' })

  it('sets HttpOnly, Secure and SameSite=Lax with the lifetime as Max-Age', () => {
    expect(buildAccessCookie(cookies, 'a.b.c', 900)).toBe(
      'sid=a.b.c; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900',
    )
    expect(buildRefreshCookie(cookies, 'r.e.f', 60)).toBe(
      'rid=r.e.f; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=60',
    )
  })

  it('clears both on their own paths', () => {
    expect(buildClearCookies(cookies)).toEqual([
      'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      'rid=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0',
    ])
  })
})

describe('parseCookieHeader', () => {
  it.each<[string | undefined, Record<string, string>]>([
    [undefined, {}],
    ['', {}],
    ['a=1; b=two', { a: '1', b: 'two' }],
    ['a=x=y', { a: 'x=y' }],
    ['a=%20b', { a: ' b' }],
    ['flag; a=1', { a: '1' }],
    ['=orphan; a=1', { a: '1' }],
    ['bad=%E0%A4%A; a=1', { a: '1' }],
  ])('%j → %j', (header, expected) => {
    expect(parseCookieHeader(header)).toEqual(expected)
  })
})

describe('extracting tokens', () => {
  it('prefers the access cookie over a bearer header', () => {
    expect(extractAccessToken({ cookie: 'access_token=fromCookie', authorization: 'Bearer fromHeader' })).toBe(
      'fromCookie',
    )
    expect(extractAccessToken({ Authorization: 'Bearer fromHeader' })).toBe('fromHeader')
  })

  it.each([
    ['no headers', undefined],
    ['an empty bearer', { authorization: 'Bearer ' }],
    ['another scheme', { authorization: 'Basic abc' }],
    ['an empty cookie', { cookie: 'access_token=' }],
  ])('finds no access token in %s', (_label, headers) => {
    expect(extractAccessToken(headers)).toBeNull()
  })

  it('reads the refresh token from its cookie only', () => {
    expect(extractRefreshToken({ cookie: 'refresh_token=r1' })).toBe('r1')
    expect(extractRefreshToken({ cookie: 'rid=r2' }, 'rid')).toBe('r2')
    expect(extractRefreshToken({ authorization: 'Bearer r3' })).toBeNull()
  })
})
