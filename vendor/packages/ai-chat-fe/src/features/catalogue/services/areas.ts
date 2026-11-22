import type { Area, AreaId } from '../types.js'

export const AREAS: readonly Area[] = [
  { id: 'surfaces', title: 'Surfaces and copy' },
  { id: 'suggestions', title: 'Suggestions' },
  { id: 'tools', title: 'Tools and generative UI' },
  { id: 'hitl', title: 'Human in the loop' },
  { id: 'context', title: 'Context and state' },
  { id: 'threads', title: 'Threads' },
  { id: 'composer', title: 'Composer' },
  { id: 'messages', title: 'Messages' },
  { id: 'theming', title: 'Theming and styling' },
  { id: 'runtime', title: 'Runtime and auth' },
  { id: 'errors', title: 'Errors and observability' },
  { id: 'not-exposed', title: 'Not exposed' },
]

export const areaById = (id: AreaId): Area => {
  const area = AREAS.find((candidate) => {
    return candidate.id === id
  })

  if (!area) throw new Error(`Unknown catalogue area: ${id}`)

  return area
}
