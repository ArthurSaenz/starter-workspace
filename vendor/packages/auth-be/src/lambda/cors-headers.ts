/**
 * A throwing host `corsHeaders` must not replace the response it decorates (after a verify that has
 * already spent the link and set the session), so that response goes out without CORS headers.
 */
const guardCorsHeaders = (corsHeaders: () => Record<string, string>) => {
  return (): Record<string, string> => {
    try {
      return corsHeaders()
    } catch {
      return {}
    }
  }
}

/** Every auth response is per-session, so `no-store` wins over anything the host's headers say. */
export const createResponseHeaders = (corsHeaders: () => Record<string, string>) => {
  const guardedCorsHeaders = guardCorsHeaders(corsHeaders)

  return (): Record<string, string> => {
    const hostHeaders = Object.entries(guardedCorsHeaders()).filter(([name]) => {
      return name.toLowerCase() !== 'cache-control'
    })

    return { ...Object.fromEntries(hostHeaders), 'Cache-Control': 'no-store' }
  }
}
