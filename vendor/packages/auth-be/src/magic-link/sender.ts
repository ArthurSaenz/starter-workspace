import { errorName } from '../errors.js'
import type { AuthContext, MagicTokenStore, Mailer } from '../ports.js'
import type { RequestMeta } from '../session/types.js'
import { withMeta } from '../session/types.js'
import { generateRawToken, hashToken } from '../tokens.js'
import type { MagicLinkEmailKind, MagicLinkEmailText, RenderMagicLinkEmail } from './email.js'
import { buildMagicLinkUrl, renderMagicLinkEmail } from './email.js'

export interface MagicLinkSenderDeps<TCtx extends AuthContext> {
  magicTokens: MagicTokenStore<TCtx>
  mailer: Mailer<TCtx>
  /** Exactly one of the two, checked by `assertMagicLinkConfig`. */
  email: MagicLinkEmailText | undefined
  renderEmail: RenderMagicLinkEmail<TCtx> | undefined
  magicLink: { baseUrl: string; verifyPath?: string }
  signInTtlMin: number
  inviteTtlMin: number
}

/** Mint a single-use link and email it; `false` means it was not delivered and is already dead. */
export const createMagicLinkSender = <TCtx extends AuthContext>(deps: MagicLinkSenderDeps<TCtx>) => {
  const { magicTokens, mailer, email: emailText, magicLink } = deps

  const renderEmail: RenderMagicLinkEmail<TCtx> =
    deps.renderEmail ??
    (({ to, link, expMin }) => {
      return renderMagicLinkEmail(to, link, expMin, emailText!)
    })

  return async (
    email: string,
    redirectUrl: string,
    meta: RequestMeta,
    kind: MagicLinkEmailKind,
    ctx?: TCtx,
  ): Promise<boolean> => {
    const ttlMin = kind === 'invite' ? deps.inviteTtlMin : deps.signInTtlMin

    await magicTokens.invalidateByEmail(email, ctx)

    const rawToken = generateRawToken()

    await magicTokens.create(
      {
        email,
        tokenHash: hashToken(rawToken),
        redirectUrl,
        expiresAt: new Date(Date.now() + ttlMin * 60 * 1000),
        ...withMeta(meta),
      },
      ctx,
    )

    const link = buildMagicLinkUrl(magicLink.baseUrl, rawToken, redirectUrl, magicLink.verifyPath)

    try {
      // Rendering sits inside the try: a template that throws leaves the same undelivered token.
      await mailer.send(await renderEmail({ to: email, link, expMin: ttlMin, kind }, ctx), ctx)

      return true
    } catch (error) {
      // A token nobody received must not stay redeemable.
      ctx?.logger?.error('Magic link send failed; invalidating the undelivered token', {
        data: { name: errorName(error) },
      })

      try {
        await magicTokens.invalidateByEmail(email, ctx)
      } catch (cleanupError) {
        ctx?.logger?.error('Failed to invalidate the undelivered magic token', {
          data: { name: errorName(cleanupError) },
        })
      }

      return false
    }
  }
}
