import { createContext } from 'react'

export interface SearchDraft {
  text: string
  claimed: boolean
}

/**
 * Search text typed but not yet sent, by filter id, for one table. Entering or leaving fullscreen
 * remounts the filter bar; the new filter takes the draft over instead of starting from `value`.
 */
export type SearchDrafts = Map<string, SearchDraft>

export const SearchDraftsContext = createContext<SearchDrafts | null>(null)
