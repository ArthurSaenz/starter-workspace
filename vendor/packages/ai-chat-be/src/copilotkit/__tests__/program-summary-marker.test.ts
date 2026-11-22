// The browser adds a local copy of the marker and the server stores its own: the two must be the same
// bytes, or the live list and the reloaded one differ. The NomaDream agent holds this marker to the
// contract (`ai-travel-agent` `program-summary-marker.contract.test.ts`); here, the bytes themselves.
import { describe, expect, it } from 'vitest'

import {
  isProgramSummaryMarker,
  isProgramSummaryMarkerId,
  programSummaryMarker,
  programSummaryMarkerId,
  programSummaryMarkerOf,
} from '../programSummaryMarker.js'

describe('the program summary marker', () => {
  it('builds the pinned bytes from the app name and the run id alone', () => {
    expect(programSummaryMarkerId('run_1')).toBe('program-summary:run_1')
    expect(programSummaryMarkerOf('NomaDream', 'run_1')).toEqual({
      id: 'program-summary:run_1',
      role: 'user',
      content:
        'NomaDream: background search run_1 has finished. Call program_result for it and sum it up in the language the traveller has been writing in.',
    })
    expect(programSummaryMarker('Acme').textBefore).toBe('Acme: background search ')
  })

  it('matches a user message by its id prefix only', () => {
    expect(isProgramSummaryMarker({ id: 'program-summary:run_1', role: 'user' })).toBe(true)
    expect(isProgramSummaryMarker({ id: 'program-summary:run_1', role: 'assistant' })).toBe(false)
    expect(isProgramSummaryMarker({ id: 'u1', role: 'user' })).toBe(false)
    expect(isProgramSummaryMarkerId('program-summary:run_1')).toBe(true)
  })
})
