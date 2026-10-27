import { render } from '@react-email/render'

import type { AuthContext, MagicLinkEmailKind, RenderMagicLinkEmail } from '@wl/auth-be'
import { formatExpiry } from '@wl/auth-be'

import { MagicLinkEmail } from './MagicLinkEmail.js'
import type { AuthEmailBrand, AuthEmailCopy } from './types.js'

export const DEFAULT_AUTH_EMAIL_COPY: Record<MagicLinkEmailKind, AuthEmailCopy> = {
  'sign-in': {
    subject: 'Your sign-in link',
    preview: 'Use this link to sign in',
    heading: 'Sign in',
    intro: 'Click the button below to sign in. No password needed.',
    buttonLabel: 'Sign in',
    expiryPrefix: 'This link expires in',
    warning: "If you didn't request this, you can safely ignore this email.",
  },
  invite: {
    subject: "You've been invited",
    preview: "You've been invited to join",
    heading: "You've been invited",
    intro: 'Click the button below to accept the invite and sign in.',
    buttonLabel: 'Accept invite',
    expiryPrefix: 'This invite expires in',
    warning: "If you weren't expecting this, you can safely ignore this email.",
  },
}

export interface AuthEmailRendererOptions {
  brand: AuthEmailBrand
  copy?: Partial<Record<MagicLinkEmailKind, Partial<AuthEmailCopy>>>
}

/** The `renderEmail` for `createMagicLinkAuth`: React Email templates rendered to HTML + plain text. */
export const createAuthEmailRenderer = <TCtx extends AuthContext = AuthContext>({
  brand,
  copy: copyOverrides,
}: AuthEmailRendererOptions): RenderMagicLinkEmail<TCtx> => {
  return async ({ to, link, expMin, kind }) => {
    const copy = { ...DEFAULT_AUTH_EMAIL_COPY[kind], ...copyOverrides?.[kind] }
    const email = <MagicLinkEmail link={link} expiry={formatExpiry(expMin)} brand={brand} copy={copy} />
    const [html, text] = await Promise.all([render(email), render(email, { plainText: true })])

    return { to, subject: copy.subject, html, text }
  }
}
