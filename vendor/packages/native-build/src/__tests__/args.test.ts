import { describe, expect, it } from 'vitest'

import { parseCliArgs } from '../args.ts'
import { CliError } from '../cli-error.ts'

const BASE = ['dev', '--domain', 'https://dev.example.com', '--version', '10.9.9']

const usageError = (argv: string[]): CliError => {
  try {
    parseCliArgs(argv)
  } catch (error) {
    return error as CliError
  }

  throw new Error(`expected ${argv.join(' ')} to be refused`)
}

describe('parseCliArgs', () => {
  it('parses env, domain origin, version and dry-run', () => {
    expect(parseCliArgs([...BASE, '--dry-run'])).toEqual({
      help: false,
      env: 'dev',
      domain: 'https://dev.example.com',
      version: '10.9.9',
      dryRun: true,
    })
  })

  it('drops bare -- tokens', () => {
    expect(
      parseCliArgs(['dev', '--domain', 'https://a.example', '--version', '1.0.0', '--', '--dry-run']),
    ).toMatchObject({
      dryRun: true,
    })
  })

  it('leaves --version optional', () => {
    expect(parseCliArgs(['prod', '--domain', 'https://www.example.com'])).toEqual({
      help: false,
      env: 'prod',
      domain: 'https://www.example.com',
      dryRun: false,
    })
  })

  it('returns help without validating anything else', () => {
    expect(parseCliArgs(['--help'])).toEqual({ help: true })
    expect(parseCliArgs(['-h'])).toEqual({ help: true })
  })

  it.each([
    ['an unexpected positional', ['dev', '10.9.9', '--domain', 'https://a.example', '--version', '1.0.0']],
    ['an unknown flag', [...BASE, '--rebuild']],
    ['an env other than dev or prod', ['staging', '--domain', 'https://x.y', '--version', '1.0.0']],
    ['a missing env', ['--domain', 'https://x.y', '--version', '1.0.0']],
    ['a missing --domain', ['dev', '--version', '1.0.0']],
    ['a non-https --domain', ['dev', '--domain', 'wss://x.y', '--version', '1.0.0']],
    ['a --domain that is not a URL', ['dev', '--domain', 'x.y', '--version', '1.0.0']],
    ['a --version that is not x.y.z', ['dev', '--domain', 'https://x.y', '--version', '10.9']],
  ])('refuses %s with exit 2', (_name, argv) => {
    const error = usageError(argv)

    expect(error).toBeInstanceOf(CliError)
    expect(error.exitCode).toBe(2)
  })
})
