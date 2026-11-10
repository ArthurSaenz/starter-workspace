import type { AuthContext, MagicLinkEmail } from '../ports.js'

export interface MagicLinkEmailText {
  subject: string
  intro: string
  linkLabel: string
  expiryPrefix?: string
  warning?: string
}

/** `invite` is an admin's `sendInviteLink`; `sign-in` is the user's own request. */
export type MagicLinkEmailKind = 'sign-in' | 'invite'

export interface MagicLinkEmailInput {
  to: string
  link: string
  expMin: number
  kind: MagicLinkEmailKind
}

/** Host-owned rendering (e.g. React Email templates) in place of the built-in plain HTML. */
export type RenderMagicLinkEmail<TCtx extends AuthContext = AuthContext> = (
  input: MagicLinkEmailInput,
  ctx?: TCtx,
) => MagicLinkEmail | Promise<MagicLinkEmail>

export const buildMagicLinkUrl = (
  baseUrl: string,
  rawToken: string,
  redirectUrl?: string,
  verifyPath = '/auth/verify',
): string => {
  const base = `${baseUrl}${verifyPath}?token=${rawToken}`

  // Verify lands on `/` without one, so `redirect=%2F` would only lengthen the link.
  return redirectUrl && redirectUrl !== '/' ? `${base}&redirect=${encodeURIComponent(redirectUrl)}` : base
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as const

export const escapeHtml = (value: string): string => {
  return value.replace(/["&'<>]/g, (char) => {
    return HTML_ESCAPES[char as keyof typeof HTML_ESCAPES]
  })
}

/** Largest whole unit, so a 72 h invite reads "3 days" rather than "4320 minutes". */
export const formatExpiry = (expMin: number): string => {
  const plural = (n: number, unit: string): string => {
    return `${n} ${unit}${n === 1 ? '' : 's'}`
  }

  if (expMin % (24 * 60) === 0) return plural(expMin / (24 * 60), 'day')

  if (expMin % 60 === 0) return plural(expMin / 60, 'hour')

  return plural(expMin, 'minute')
}

export const renderMagicLinkEmail = (
  to: string,
  link: string,
  expMin: number,
  text: MagicLinkEmailText,
): MagicLinkEmail => {
  const expiryLine = `${text.expiryPrefix ?? 'This link expires in'} ${formatExpiry(expMin)}.`
  const warning = text.warning ?? "If you didn't request this, ignore this email."

  return {
    to,
    subject: text.subject,
    text: `${text.intro}\n\n${link}\n\n${expiryLine}\n\n${warning}`,
    html:
      `<p>${escapeHtml(text.intro)}</p>` +
      `<p><a href="${link}">${escapeHtml(text.linkLabel)}</a></p>` +
      `<p>${escapeHtml(expiryLine)}</p>` +
      `<p>${escapeHtml(warning)}</p>`,
  }
}
