import type { Context } from 'aws-lambda'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCopilotkitHandlers } from '../lambda/copilotkit.js'
import { consoleJsonLogger } from '../ports.js'
import type { ChatLogger, LogFields } from '../ports.js'
import { hostOptions } from './helpers/handler-options.js'

interface Recorded {
  service: string
  level: string
  message: string
  fields: LogFields
}

const recordingFactory = () => {
  const lines: Recorded[] = []
  const keysOf = new Map<string, LogFields>()

  const createLogger = (service: string): ChatLogger => {
    const record = (level: string) => {
      return (message: string, ...fields: LogFields[]) => {
        lines.push({ service, level, message, fields: Object.assign({}, keysOf.get(service), ...fields) })
      }
    }

    return {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      appendKeys: (keys) => {
        keysOf.set(service, { ...keysOf.get(service), ...keys })
      },
      resetKeys: () => {
        keysOf.delete(service)
      },
    }
  }

  return { lines, createLogger }
}

const unsignedRun = {
  path: '/v1/ai/copilotkit/agent/travelAiAgent/run',
  httpMethod: 'POST',
  headers: {},
  body: '{}',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createCopilotkitHandlers logger', () => {
  it('writes the request lines through the host-supplied logger, under the handler module name', async () => {
    const { lines, createLogger } = recordingFactory()
    const stdout = vi.spyOn(process.stdout, 'write')
    const stderr = vi.spyOn(process.stderr, 'write')

    const { handler } = createCopilotkitHandlers({
      ...hostOptions(),
      loadAgent: async () => {
        throw new Error('the gate refuses before the agent loads')
      },
      createLogger,
    })

    const result = await handler(unsignedRun, { awsRequestId: 'req-ports' } as unknown as Context)

    expect(result.statusCode).toBe(401)
    expect(lines).toEqual([
      expect.objectContaining({
        service: 'copilotkit.ts',
        level: 'info',
        message: 'CopilotKit request start',
        fields: expect.objectContaining({ awsRequestId: 'req-ports' }),
      }),
      expect.objectContaining({
        service: 'copilotkit.ts',
        level: 'warn',
        message: 'CopilotKit request rejected: no valid customer session',
      }),
    ])
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })
})

describe('consoleJsonLogger', () => {
  it('writes one JSON line per call with fields and appended keys at the top level, warnings to stderr', () => {
    const out: string[] = []
    const err: string[] = []

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))

      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk))

      return true
    })

    const logger = consoleJsonLogger('svc')

    logger.appendKeys({ customerId: 'c1' })
    logger.info('hello', { metric: 'm1' })
    logger.resetKeys()
    logger.warn('careful')

    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0] ?? '')).toMatchObject({
      level: 'INFO',
      message: 'hello',
      service: 'svc',
      customerId: 'c1',
      metric: 'm1',
    })
    expect(JSON.parse(err[0] ?? '')).not.toHaveProperty('customerId')
    expect(JSON.parse(err[0] ?? '')).toMatchObject({ level: 'WARN', message: 'careful' })
  })

  it('still writes a line when a field cannot be serialised', () => {
    const out: string[] = []

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))

      return true
    })

    const circular: { self?: unknown } = {}

    circular.self = circular
    consoleJsonLogger('svc').debug('loop', { circular })

    expect(JSON.parse(out[0] ?? '')).toEqual({ level: 'DEBUG', message: 'loop', service: 'svc' })
  })
})
