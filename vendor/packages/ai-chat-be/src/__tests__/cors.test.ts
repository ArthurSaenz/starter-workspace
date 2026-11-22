import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildCorsHeaders, extractRequestOrigin, resolveCorsOrigin } from '../lambda/cors.js'

const ALLOWED = 'https://nomadream.ai, https://arthur.nomadream.ai'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveCorsOrigin', () => {
  it('returns null when ALLOWED_ORIGINS is unset or empty (no CORS headers at all)', () => {
    vi.stubEnv('ALLOWED_ORIGINS', '')

    expect(resolveCorsOrigin('https://nomadream.ai')).toBeNull()
  })

  it("'*' disables the allow-list and answers every caller, even without an Origin", () => {
    vi.stubEnv('ALLOWED_ORIGINS', ' * ')

    expect(resolveCorsOrigin(undefined)).toBe('*')
    expect(resolveCorsOrigin('https://evil.example')).toBe('*')
  })

  it('echoes only an origin present in the comma-separated list, trimming whitespace', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED)

    expect(resolveCorsOrigin('https://arthur.nomadream.ai')).toBe('https://arthur.nomadream.ai')
    expect(resolveCorsOrigin('https://nomadream.ai')).toBe('https://nomadream.ai')
    expect(resolveCorsOrigin('https://evil.example')).toBeNull()
    expect(resolveCorsOrigin('nomadream.ai')).toBeNull()
  })

  it('returns null for a missing Origin when an allow-list is configured', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED)

    expect(resolveCorsOrigin(undefined)).toBeNull()
  })
})

describe('extractRequestOrigin', () => {
  it('reads both header casings API Gateway may deliver', () => {
    expect(extractRequestOrigin({ origin: 'https://a.example' })).toBe('https://a.example')
    expect(extractRequestOrigin({ Origin: 'https://b.example' })).toBe('https://b.example')
    expect(extractRequestOrigin({ origin: 'https://a.example', Origin: 'https://b.example' })).toBe('https://a.example')
  })

  it('returns undefined without headers or without an Origin header', () => {
    expect(extractRequestOrigin(undefined)).toBeUndefined()
    expect(extractRequestOrigin({ host: 'lambda.local' })).toBeUndefined()
  })
})

describe('buildCorsHeaders', () => {
  it('returns an empty object when the origin is not allowed', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED)

    expect(buildCorsHeaders({ origin: 'https://evil.example' })).toEqual({})
    expect(buildCorsHeaders(undefined)).toEqual({})
  })

  it('builds the full header set from an event headers object, with defaults', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED)

    expect(buildCorsHeaders({ Origin: 'https://nomadream.ai' })).toEqual({
      'Access-Control-Allow-Origin': 'https://nomadream.ai',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin',
    })
  })

  it('accepts a bare origin string and honours method/header overrides', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED)

    expect(
      buildCorsHeaders('https://arthur.nomadream.ai', { allowMethods: 'POST', allowHeaders: 'Content-Type' }),
    ).toMatchObject({
      'Access-Control-Allow-Origin': 'https://arthur.nomadream.ai',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
  })

  it('names Access-Control-Expose-Headers only when asked to', () => {
    vi.stubEnv('ALLOWED_ORIGINS', ALLOWED)

    expect(buildCorsHeaders('https://nomadream.ai')).not.toHaveProperty('Access-Control-Expose-Headers')
    expect(buildCorsHeaders('https://nomadream.ai', { exposeHeaders: 'x-ai-model' })).toMatchObject({
      'Access-Control-Expose-Headers': 'x-ai-model',
    })
    expect(buildCorsHeaders('https://evil.example', { exposeHeaders: 'x-ai-model' })).toEqual({})
  })

  it("under '*' sets a wildcard origin (Vary still present)", () => {
    vi.stubEnv('ALLOWED_ORIGINS', '*')

    expect(buildCorsHeaders({})).toMatchObject({ 'Access-Control-Allow-Origin': '*', Vary: 'Origin' })
  })
})
