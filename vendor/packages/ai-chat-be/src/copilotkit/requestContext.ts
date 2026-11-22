import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The per-request identity the Lambda verified, carried to the graph so a server-tool
 * invocation can be attributed in the logs.
 *
 * It travels through `AsyncLocalStorage` rather than through the agent, because the agent is
 * built ONCE at cold start (`createFetchHandler`) and the CopilotKit runtime clones it
 * internally per request — there is no constructor seam a handler could inject into. It
 * cannot travel on the wire either: `RunAgentInput` is written by the browser, and an
 * identity the caller can set is not an identity.
 */
export interface ChatRequestContext {
  readonly customerId: string
  readonly awsRequestId: string
  /**
   * Counts the run against the traveller's day; set only when the Lambda let the run in without
   * counting it (its body read as a follow-up). The runner calls it once the trusted history shows the
   * run does answer a new question; a refusal ends the run with RUN_ERROR `code` and `message`.
   */
  readonly countTurn?: () => Promise<TurnRefusal | undefined>
}

export interface TurnRefusal {
  code: string
  message: string
}

const storage = new AsyncLocalStorage<ChatRequestContext>()

export const runWithRequestContext = async <T>(context: ChatRequestContext, run: () => Promise<T>): Promise<T> => {
  return storage.run(context, run)
}

/** `undefined` outside a Lambda invocation — a unit test driving the graph directly. */
export const currentRequestContext = (): ChatRequestContext | undefined => {
  return storage.getStore()
}
