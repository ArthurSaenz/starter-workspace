import { createHash } from 'node:crypto'

/**
 * The LangSmith root run id of one turn, derived from the turn itself: the agent hands it to the graph
 * as `runId`, and the runner computes the same id to remember which trace wrote each answer, with no
 * channel between them. Owner-scoped, because the AG-UI thread and run ids are minted by the browser.
 * Shaped as a v4 UUID, the only run-id form LangSmith accepts.
 */
export const traceRunIdOf = (owner: string, threadId: string, runId: string): string => {
  const hex = createHash('sha256').update(`${owner}\n${threadId}\n${runId}`).digest('hex')
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
