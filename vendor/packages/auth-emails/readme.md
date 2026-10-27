# @wl/auth-emails

[React Email](https://react.email) templates for the `@wl/auth-be` magic-link and invite emails: one
branded, Tailwind-styled layout rendered to table-based HTML plus a plain-text part. Plugs into
`createMagicLinkAuth` through its `renderEmail` option, so `@wl/auth-be` itself stays
React-free.

## Host wiring

```ts
import { createMagicLinkAuth } from '@wl/auth-be'
import { createAuthEmailRenderer } from '@wl/auth-emails'

const auth = createMagicLinkAuth<Customer, Me, Options>({
  // …stores, mailer, jwt, magicLink as before; drop `email`
  renderEmail: createAuthEmailRenderer({
    brand: { name: 'Acme', logoUrl: 'https://cdn.acme.com/logo.png', primaryColor: '#ff5a00' },
    copy: { 'sign-in': { subject: 'Вхід до Acme', buttonLabel: 'Увійти' } },
  }),
  toMe: (u) => ({ id: u.id, email: u.email }),
})
```

`copy` overrides are per email kind (`sign-in`, `invite`) and merge over `DEFAULT_AUTH_EMAIL_COPY`.
A template that throws is treated like a failed send: the undelivered token is invalidated.

## Public API

| Export                               | What it is                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `createAuthEmailRenderer(options)`   | `{ brand, copy? }` → the `renderEmail` function for `createMagicLinkAuth`.         |
| `DEFAULT_AUTH_EMAIL_COPY`            | The English copy for each kind.                                                    |
| `MagicLinkEmail`                     | The React component, for a host that renders it inside its own layout or pipeline. |
| `AuthEmailBrand`, `AuthEmailCopy`, … | Option types.                                                                      |

## Preview

`pnpm run email-dev` serves every template in `previews/` at http://localhost:3030 with live reload.

## Dependencies

Runtime: `react-email` (components), `@react-email/render`, `@wl/auth-be`; `react` / `react-dom` are
peers. The preview server (`@react-email/ui`) is a dev dependency only and never ships in a Lambda
bundle.
