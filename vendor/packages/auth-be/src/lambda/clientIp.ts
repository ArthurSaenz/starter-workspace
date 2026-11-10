import { readHeader } from '../http/headers.js'
import type { AuthContext } from '../ports.js'
import type { LambdaEvent } from './types.js'

export interface ClientIpOptions {
  trustedProxyHops: number
}

const forwardedChain = (event: LambdaEvent): string[] => {
  return (readHeader(event.headers, 'x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => {
      return entry.trim()
    })
    .filter(Boolean)
}

/**
 * The client IP: `sourceIp` with 0 hops, else the X-Forwarded-For entry `trustedProxyHops` from the
 * right. Entries further left are client-supplied and spoofable, so they are never read.
 */
export const extractSourceIp = (event: LambdaEvent, trustedProxyHops = 0): string => {
  const sourceIp = (event.requestContext?.identity?.sourceIp || '').toString().trim()

  if (trustedProxyHops === 0) return sourceIp

  const chain = forwardedChain(event)

  // A short chain, or a hop count that is not a positive integer, indexes past the array.
  return chain[chain.length - trustedProxyHops] ?? sourceIp
}

export const extractUserAgent = (event: LambdaEvent): string => {
  return readHeader(event.headers, 'user-agent') || ''
}

/** `extractSourceIp` bound to a validated hop count, warning once when 0 hops looks wrong. */
export const createClientIpResolver = <TCtx extends AuthContext>(options: ClientIpOptions | undefined) => {
  // Read as optional: a JS caller gets no type check.
  const trustedProxyHops = options?.trustedProxyHops

  if (typeof trustedProxyHops !== 'number' || !Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error('auth: clientIp.trustedProxyHops must be a non-negative integer')
  }

  let warnedAboutHops = false

  return (event: LambdaEvent, ctx?: TCtx): string => {
    const ip = extractSourceIp(event, trustedProxyHops)

    // The leftmost entry is the original client: it differs from `sourceIp` when a proxy of ours sits
    // in front (AWS's own edge hops sit to its right). Only flagged once a logger actually took it.
    if (trustedProxyHops === 0 && !warnedAboutHops && ctx?.logger) {
      const chain = forwardedChain(event)

      if (chain.length > 0 && chain[0] !== ip) {
        ctx.logger.warn('X-Forwarded-For names a client other than sourceIp; check clientIp.trustedProxyHops', {
          data: { forwardedCount: chain.length },
        })
        warnedAboutHops = true
      }
    }

    return ip
  }
}
