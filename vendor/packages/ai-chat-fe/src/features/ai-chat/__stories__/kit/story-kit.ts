import type { FakeRuntime } from '../../__tests__/helpers/index.js'

// The texts of ../../services/chat-failure.ts as the traveller reads them.
export const SESSION_EXPIRED_TEXT = 'Your session has expired — sign in again to continue.'
export const UNAVAILABLE_TEXT = 'The assistant is unavailable right now. Please try again.'

export const runtimeOf = (loaded: Record<string, unknown>): FakeRuntime => {
  return loaded.runtime as FakeRuntime
}
