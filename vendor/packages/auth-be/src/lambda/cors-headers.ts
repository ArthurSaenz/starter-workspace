/**
 * A throwing host `corsHeaders` must not replace the response it decorates (after a verify that has
 * already spent the link and set the session), so that response goes out without CORS headers.
 */
export const guardCorsHeaders = (corsHeaders: () => Record<string, string>) => {
  return (): Record<string, string> => {
    try {
      return corsHeaders()
    } catch {
      return {}
    }
  }
}
