import type { Message } from '@ag-ui/client'

const ID_PREFIX = 'program-summary:'

/**
 * The server's turn that starts a finished background run's summary, spoken by the product (`appName`).
 * A browser or agent that writes its own copy of the marker must keep these bytes (an agent package holds
 * its copy to its contract in a test of its own).
 */
export const programSummaryMarker = (appName: string) => {
  return {
    idPrefix: ID_PREFIX,
    textBefore: `${appName}: background search `,
    textAfter:
      ' has finished. Call program_result for it and sum it up in the language the traveller has been writing in.',
  } as const
}

export const programSummaryMarkerId = (runId: string): string => {
  return `${ID_PREFIX}${runId}`
}

export const isProgramSummaryMarkerId = (id: string): boolean => {
  return id.startsWith(ID_PREFIX)
}

/** The server's turn that starts a finished run's summary: stored as a user message, never the traveller's words. */
export const isProgramSummaryMarker = (message: Pick<Message, 'id' | 'role'>): boolean => {
  return message.role === 'user' && isProgramSummaryMarkerId(message.id)
}

export const programSummaryMarkerOf = (appName: string, runId: string): Message => {
  const { textBefore, textAfter } = programSummaryMarker(appName)

  return { id: programSummaryMarkerId(runId), role: 'user', content: `${textBefore}${runId}${textAfter}` }
}
