export type HeaderBag = Record<string, string | undefined> | null | undefined

/** Case-insensitive: API Gateway passes header names through in whatever case the client sent. */
export const readHeader = (headers: HeaderBag, name: string): string | undefined => {
  if (!headers) return undefined

  const wanted = name.toLowerCase()

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value ?? undefined
  }

  return undefined
}
