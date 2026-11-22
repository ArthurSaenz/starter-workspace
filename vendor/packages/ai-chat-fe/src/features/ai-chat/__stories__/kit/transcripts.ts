import type { useAgent } from '@copilotkit/react-core/v2'

import { MARKDOWN_REPLY, REPLY } from '../../__tests__/helpers/index.js'

export type Transcript = ReturnType<typeof useAgent>['agent']['messages']

export const exchange = (question: string, answer: string): Transcript => {
  return [
    { id: 'seed-user', role: 'user', content: question },
    { id: 'seed-assistant', role: 'assistant', content: answer },
  ]
}

export const SHORT_EXCHANGE = exchange('hello', REPLY)
export const LONG_EXCHANGE = exchange('three weeks in Bangkok', MARKDOWN_REPLY)
