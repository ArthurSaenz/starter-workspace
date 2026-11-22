// A failed run is kept in `ai_run_failures` whatever LangSmith's head sampling dropped, and keeping it
// never changes how the run ends.
import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
import process from 'node:process'
import { firstValueFrom, toArray } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryStorage } from '../../__tests__/helpers/memory-storage.js'
import { settleBackgroundWrites } from '../../tools/backgroundWrites.js'
import { InProcessAgent, RUN_ERROR_MESSAGE } from '../inProcessAgent.js'
import type { StreamableGraph } from '../inProcessAgent.js'
import { runWithRequestContext } from '../requestContext.js'
import { traceRunIdOf } from '../traceRunId.js'

const storage = new MemoryStorage()

const PROMPT_VERSION = '2026-11-03.6'
const OWNER = 'cust-42'

// One tool finishes, a second is still running when the model call throws.
const failingGraph: StreamableGraph = {
  streamEvents: () => {
    return (async function* () {
      yield { event: 'on_tool_start', name: 'live_hotels_search', run_id: 't1' } as never
      yield { event: 'on_tool_end', name: 'live_hotels_search', run_id: 't1', data: { output: {} } } as never
      yield { event: 'on_tool_start', name: 'web_read', run_id: 't2' } as never
      throw new Error('model exploded')
    })()
  },
}

const input = {
  threadId: `${OWNER}:chat-1`,
  runId: 'run-1',
  state: {},
  messages: [{ id: 'u1', role: 'user', content: 'hi' }],
  tools: [],
  context: [],
  forwardedProps: {},
} as RunAgentInput

const runInRequest = async (agent: InProcessAgent): Promise<BaseEvent[]> => {
  return runWithRequestContext({ customerId: OWNER, awsRequestId: 'req-1' }, async () => {
    return firstValueFrom(agent.run(input).pipe(toArray()))
  })
}

const captureLogs = (): string[] => {
  const written: string[] = []

  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))

      return true
    })
  }

  return written
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('inProcessAgent failed-run record', () => {
  it('keeps a failed run with its error, prompt version, thread, run and tools under 0.25 trace sampling', async () => {
    vi.stubEnv('LANGSMITH_TRACING_SAMPLING_RATE', '0.25')

    const agent = new InProcessAgent({
      graph: failingGraph,
      graphId: 'travelAiAgent',
      recursionLimit: 8,
      promptVersion: PROMPT_VERSION,
      recordFailure: async (failure) => {
        await storage.runFailures.record(failure)
      },
    })

    captureLogs()
    await expect(runInRequest(agent)).rejects.toThrow(RUN_ERROR_MESSAGE)
    await settleBackgroundWrites(5000)

    const traceRunId = traceRunIdOf(OWNER, input.threadId, input.runId)

    const rows = [...storage.failures.values()].filter((row) => {
      return row.traceRunId === traceRunId
    })

    expect(rows).toEqual([
      expect.objectContaining({
        customerId: OWNER,
        threadId: input.threadId,
        runId: input.runId,
        promptVersion: PROMPT_VERSION,
        errorCode: 'Error',
        errorMessage: 'model exploded',
        toolCalls: [
          expect.objectContaining({ name: 'live_hotels_search', status: 'success' }),
          expect.objectContaining({ name: 'web_read', status: 'unfinished' }),
        ],
      }),
    ])
    expect(rows[0]?.model).toEqual(expect.any(String))
  })

  it('still ends with RUN_ERROR and logs the miss when the record cannot be written', async () => {
    const agent = new InProcessAgent({
      graph: failingGraph,
      graphId: 'travelAiAgent',
      recordFailure: () => {
        return Promise.reject(new Error('database down'))
      },
      recursionLimit: 8,
    })

    const written = captureLogs()

    await expect(runInRequest(agent)).rejects.toThrow(RUN_ERROR_MESSAGE)
    await settleBackgroundWrites(5000)

    expect(
      written.some((line) => {
        return line.includes('failed run not recorded') && line.includes('database down')
      }),
    ).toBe(true)
  })
})
