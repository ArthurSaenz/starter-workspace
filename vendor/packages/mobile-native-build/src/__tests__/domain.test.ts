import { describe, expect, it } from 'vitest'

import { CliError } from '../cli-error.ts'
import { resolveDomain } from '../domain.ts'

describe('resolveDomain', () => {
  it('returns the --domain origin when the env is unset', () => {
    expect(resolveDomain('https://www.example.com/some/path', undefined)).toBe('https://www.example.com')
  })

  it.each(['https://www.example.com/', 'https://www.example.com/mfe', 'https://www.example.com'])(
    'accepts an env value with the same origin: %s',
    (envValue) => {
      expect(resolveDomain('https://www.example.com', envValue)).toBe('https://www.example.com')
    },
  )

  it('refuses an env value with a different origin with exit 2', () => {
    expect(() => {
      return resolveDomain('https://www.example.com', 'https://dev.example.com')
    }).toThrow(
      expect.objectContaining({
        exitCode: 2,
        message: expect.stringContaining('unset it or pass the matching --domain'),
      }),
    )
  })

  it('refuses an env value that is not a URL', () => {
    expect(() => {
      return resolveDomain('https://www.example.com', 'dev.example.com')
    }).toThrow(CliError)
  })
})
