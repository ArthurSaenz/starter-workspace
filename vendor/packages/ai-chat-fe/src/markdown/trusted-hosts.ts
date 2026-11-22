import { createContext } from 'react'

/**
 * The loyalty chains' own sites, copied from `CHAIN_DOMAINS` in
 * `packages/ai-travel-agent/src/shared/hotelIdentity.ts` (a Node-only package the browser never
 * imports). Keep the two in step: a domain missing here only costs a link its path and query string.
 */
export const CHAIN_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  accor: ['accor.com', 'fairmont.com', 'raffles.com', 'swissotel.com'],
  hilton: ['hilton.com'],
  hyatt: ['hyatt.com'],
  ihg: ['ihg.com', 'kimptonhotels.com', 'sixsenses.com'],
  marriott: ['marriott.com', 'ritzcarlton.com'],
  minor: ['minorhotels.com', 'anantara.com', 'avanihotels.com', 'nh-hotels.com', 'oakshotels.com', 'tivolihotels.com'],
}

/**
 * Hosts whose links keep their path, query and fragment: the chains' sites. A consumer adds its own
 * through `trustedHosts`.
 */
export const TRUSTED_LINK_DOMAINS: readonly string[] = Object.values(CHAIN_DOMAINS).flat()

/** `host` is one of `domains` or a subdomain of one. */
export const isHostIn = (host: string, domains: readonly string[]): boolean => {
  const normalised = host.toLowerCase()

  return domains.some((domain) => {
    const normalisedDomain = domain.toLowerCase()

    return normalised === normalisedDomain || normalised.endsWith(`.${normalisedDomain}`)
  })
}

/**
 * The consumer's own hosts, for every `SafeMarkdown` link below it: Streamdown hands a link component only
 * the element's props, and a context keeps `SAFE_COMPONENTS` one object (Streamdown memoises on it).
 */
export const TrustedHostsContext = createContext<readonly string[]>([])

export const isTrustedHost = (host: string, trustedHosts: readonly string[] = []): boolean => {
  return isHostIn(host, trustedHosts) || isHostIn(host, TRUSTED_LINK_DOMAINS)
}
