import { SiteIndexError } from './errors.js'

/** `JSON.parse` whose failure names `source` (an S3 key or a file path) instead of a bare SyntaxError. */
export const parseJson = (text: string, source: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new SiteIndexError(`${source} is not valid JSON`, [(error as Error).message], { cause: error })
  }
}
