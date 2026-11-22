// A runtime that failed to build is answered from memory for a while, then built again: a transient
// failure must not leave a warm container broken for its whole life.
import type { Context } from 'aws-lambda'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StreamableGraph } from '../copilotkit/inProcessAgent.js'
import { hostOptions } from './helpers/handler-options.js'
import { TEST_JWT_SECRET, sessionCookie } from './helpers/session.js'

vi.mock('@copilotkit/runtime/v2', () => {
  return {
    CopilotSseRuntime: class {},
    TranscriptionService: class {},
    createCopilotRuntimeHandler: () => {
      return async () => {
        return Response.json({ ok: true })
      }
    },
  }
})

vi.mock('../copilotkit/inProcessAgent.js', () => {
  return { InProcessAgent: class {} }
})

vi.mock('../copilotkit/customerChatsRunner.js', () => {
  return { CustomerChatsRunner: class {} }
})

const { INIT_ERROR_TTL_MS, createCopilotkitHandlers } = await import('../lambda/copilotkit.js')

const context = { awsRequestId: 'init-test' } as Context

describe('runtime build failure', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('answers from the remembered failure, then builds again once it expires', async () => {
    vi.stubEnv('CUSTOMER_JWT_ACCESS_SECRET', TEST_JWT_SECRET)
    vi.useFakeTimers({ toFake: ['Date'] })

    const loadAgent = vi
      .fn<() => Promise<{ graph: StreamableGraph; graphId: string; recursionLimit: number }>>()
      .mockRejectedValueOnce(new Error('secret not loaded yet'))
      .mockResolvedValue({ graph: {} as StreamableGraph, graphId: 'travelAiAgent', recursionLimit: 8 })

    const { handler } = createCopilotkitHandlers({ ...hostOptions(), loadAgent })

    const info = async () => {
      return (
        await handler(
          {
            path: '/v1/ai/copilotkit/info',
            httpMethod: 'GET',
            headers: { host: 'lambda.local', cookie: sessionCookie() },
          },
          context,
        )
      ).statusCode
    }

    expect(await info()).toBe(500)
    expect(await info()).toBe(500)
    expect(loadAgent).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + INIT_ERROR_TTL_MS)

    expect(await info()).toBe(200)
    expect(loadAgent).toHaveBeenCalledTimes(2)
  })
})
