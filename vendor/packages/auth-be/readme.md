# @wl/auth-be

Passwordless (magic-link) authentication for a Lambda API: request a link → verify it → a
15-minute access JWT + a 7-day rotating refresh JWT in `HttpOnly` cookies, refresh-token reuse
detection, logout, `me`. It owns the flow and none of the storage: the host passes its user table,
token / session / rate-limit stores and mailer in as small interfaces (`src/ports.ts`). Frontend
counterpart: `@wl/auth-fe`.

A host can run several instances side by side (e.g. one over a customers table, one over a staff
table); each host's wiring is one `createMagicLinkAuth(...)` call. A sibling API can call `verifySession` to
honour the same cookie.

## Portability contract

- Runtime dependency: `jsonwebtoken`. No imports from `apps/*` or `packages/*`, no AWS SDK, no ORM.
  Copy `vendor/packages/auth-be` into another repo, `pnpm add jsonwebtoken`, build.
- Errors are `AuthError { code, status }` unless the host passes `createError` to map them onto its
  own error class (e.g. a `ManagedError`, so the browser sees the same `type`).
- Every store method gets the caller's context as its last argument, untouched (`TCtx`), so
  repositories that take an options bag (`{ logger }`) plug in directly.

## Public API

| Export                                                                                                                | What it is                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createMagicLinkAuth(config)`                                                                                         | The engine: `requestMagicLink`, `sendInviteLink`, `verifyMagicLink`, `refreshSession`, `logout`, `requireUser`, `authenticate`, `getMe`, `issueSession`, cookie helpers.                                               |
| `createAuthRoutes(auth, { corsHeaders, clientIp, requestMagicLinkMessage? })`                                         | The five endpoints as Lambda bodies (`requestMagicLink`, `verifyMagicLink`, `refresh`, `logout`, `me`), each `{ handle, fallbackResponse?, clearCookiesOn401? }`. `clientIp` is required: see [Client IP](#client-ip). |
| `extractSourceIp(event, trustedProxyHops = 0)`                                                                        | The rate-limit client IP: `sourceIp`, or the X-Forwarded-For entry `trustedProxyHops` from the right.                                                                                                                  |
| `createAuthHandlers(auth, { corsHeaders, clientIp, requestMagicLinkMessage?, context?, toErrorResponse?, onError? })` | `createAuthRoutes` + `toLambdaHandler` in one call: the five endpoints as ready Lambda handlers.                                                                                                                       |
| `toLambdaHandler(route, options)`                                                                                     | A complete handler for hosts without their own controller envelope (maps `AuthError`, honours fallback / clear-cookies).                                                                                               |
| `verifySession(headers, { issuer, audience, accessSecret })`                                                          | For another service behind the same origin: the access-token payload or `null`. Fails closed.                                                                                                                          |
| `signAccessToken` / `verifyAccessToken` / `signRefreshToken` / `verifyRefreshToken`                                   | HS256 with issuer + audience pinning. A signed token is `{ token, ttlSec }`, `ttlSec` being its lifetime in seconds.                                                                                                   |
| `sanitizeRedirectUrl`, `extractAccessToken`, `extractRefreshToken`, `buildClearCookies`, …                            | The pure helpers the engine is built from.                                                                                                                                                                             |

### `createMagicLinkAuth` config

| Key                                                                     | Required | Meaning                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                                                                 | yes      | `{ findByEmail, findById }` → a row with `id`, `email`, `invited?`, `roles?`. The engine never creates users.                                                                                                                                                                                                                                                                                                       |
| `magicTokens`                                                           | yes      | `{ create, consumeByHash, release, invalidateByEmail }`. `consumeByHash` must be single-use (return and spend atomically); `release(tokenHash, record)` undoes a consume, never an invalidation: a store that deletes on consume re-inserts `record` only when no newer token exists for `record.email` (atomically). Only SHA-256 hashes are stored.                                                               |
| `sessions`                                                              | yes      | `{ create, findByTokenHash, rotate, findSuccessor, revokeByTokenHash, revokeAllForUser }`. `findByTokenHash` returns the row whatever its state, revoked included; `rotate` must return `null` when the row is already rotated or revoked; `findSuccessor(id)` returns the row `rotate(id, …)` inserted (e.g. via a `replaced_by` column), or `null`. Run the [store contract kit](#store-contract-kit) against it. |
| `rateLimiter`                                                           | yes      | `{ incrementAndCheck(key, limit, windowSec) }` → `{ allowed }`.                                                                                                                                                                                                                                                                                                                                                     |
| `mailer`                                                                | yes      | `{ send({ to, subject, text, html }) }`. A throw invalidates the undelivered token.                                                                                                                                                                                                                                                                                                                                 |
| `jwt`                                                                   | yes      | `{ accessSecret, refreshSecret, issuer, audience, accessTtlSec?, refreshTtlSec?, refreshGraceSec = 30 }`. Secrets ≥ 32 chars and different from each other, or construction throws.                                                                                                                                                                                                                                 |
| `magicLink`                                                             | yes      | `{ baseUrl, verifyPath = '/auth/verify', ttlMin = 15, inviteTtlMin = 4320 }`.                                                                                                                                                                                                                                                                                                                                       |
| `email`                                                                 | one of   | `{ subject, intro, linkLabel, expiryPrefix?, warning? }`: the copy for the built-in plain HTML email, HTML-escaped in its html part.                                                                                                                                                                                                                                                                                |
| `renderEmail`                                                           | one of   | `({ to, link, expMin, kind: 'sign-in' \| 'invite' }, ctx) => { to, subject, text, html }`, sync or async: host-owned templates (e.g. `@wl/auth-emails`).                                                                                                                                                                                                                                                            |
| `toMe`                                                                  | yes      | Row → the `GET me` DTO.                                                                                                                                                                                                                                                                                                                                                                                             |
| `uninvitedRequest`                                                      | no       | `'silent'` (default: public surface, same body for every address) or `'reject'` (NOT_INVITED 403, for internal tools). See "Timing" below.                                                                                                                                                                                                                                                                          |
| `isAllowed`, `rolesOf`, `onSignIn`                                      | no       | Allowlist predicate (default `invited === true`), roles claim (default `roles ?? []`), sign-in side effects.                                                                                                                                                                                                                                                                                                        |
| `minResponseMs`                                                         | no       | Floor on `requestMagicLink`'s response time, every outcome included (default 0). See "Timing" below.                                                                                                                                                                                                                                                                                                                |
| `cookies`, `rateLimits`, `validate`, `createError`, `notInvitedMessage` | no       | Cookie names/paths (default `access_token` `/`, `refresh_token` `/api/v1/auth`), budgets (5/email, 20/IP per hour…), validators, error mapping.                                                                                                                                                                                                                                                                     |

`magicLink.baseUrl` must be an absolute http(s) URL and every TTL (`jwt.*TtlSec`, `magicLink.*TtlMin`) a
positive integer, or construction throws: a bad TTL would otherwise fail only after verify spent the link.
The same goes for every `rateLimits` budget and `windowSec` (positive integers), `keyPrefix` (a non-empty
string; `null` or `undefined` keeps any default) and `jwt.refreshGraceSec` (a non-negative integer): a NaN or 0 budget would refuse every request.

Every flow takes its input object first and the host context second: `requestMagicLink(input, ctx)`,
`verifyMagicLink({ rawToken, ...meta }, ctx)`, `refreshSession({ refreshToken, ...meta }, ctx)`.

### Invariants the engine keeps

- No user row is ever created by auth; the allowlist is re-asked at request, verify, refresh,
  `authenticate` **and** `getMe`. A refresh, `authenticate` or `getMe` by a no-longer-allowed user
  answers `NOT_INVITED` 403 and revokes all their sessions, so a later re-invite starts clean. A
  failed revoke is logged and the 403 stands. `requireUser` reads the JWT only, so a revoke reaches
  it when the access token expires (`jwt.accessTtlSec`): authorise from `authenticate` where that
  lag matters.
- A replayed (already rotated) refresh token revokes every session of its user, unless it arrives
  within `jwt.refreshGraceSec` of its rotation while the successor session is still live: that is
  a second tab, and it gets an access token for the successor and no refresh cookie
  (`refreshSession` resolves `RefreshResult`: a `TokenPair`, or an `AccessOnlyPair` whose
  `refreshToken` / `refreshCookie` are `undefined`). The loser of a concurrent rotation is answered
  the same way, and fails alone (401) when there is no live successor. A thief replaying inside the
  window gets one access token, never a refresh token.
- The other direction: a thief who refreshes first with a stolen token leaves the victim's next
  refresh inside the window answered with access to the thief's session, so theft is noticed only
  once the window closes. Every grace answer logs a warning
  (`Refresh answered from the grace window with a rotated token`, data `{ userId, rotatedSessionId, successorSessionId }`).
- Only a rotated token counts as replayed. A token revoked by logout or a revoke-all has no
  successor, so a refresh racing a logout fails alone (401, warning
  `Refresh with a revoked, never-rotated token`) and the user's other sessions live on. Theft
  detection therefore rests on `findSuccessor`: a store whose `findSuccessor` always returns `null`
  turns every replay into a plain 401 and never revokes the thief's session. A store that prunes
  rotated rows' successors loses reuse detection for those tokens, so prune only rows past their
  `expiresAt`.
- The session row must belong to the refresh token's subject (`String(session.userId) === sub`),
  and so must a grace successor. A mismatch is a store bug: 401 `INVALID_REFRESH_TOKEN`, an error
  log (`Refresh token subject does not match its session row`), no rotation and no revoke-all.
  `String()` lets an adapter hand back a non-string id such as an `ObjectId`.
- Every route response and every `toLambdaHandler` error carries `Cache-Control: no-store`, over
  any value a host `corsHeaders` sets. See [Caching](#caching).
- A verify that fails on a store or `onSignIn` error after consuming the link releases it, so the user can click again; an expired link or a refused address stays spent.
- A released link re-runs `onSignIn` on the next click, so `onSignIn` must be idempotent.
- `sendInviteLink` resolves `{ emailSent }`. `false` means the mailer or the template threw and the
  link is already invalidated: show the admin that the invite did not go out. `requestMagicLink`
  stays silent whatever happens, so an anonymous caller learns nothing.
- A throwing or rejecting `onError` is ignored (it is awaited first) and a throwing `corsHeaders` yields no CORS headers: neither
  replaces the real response or error envelope.
- The redirect target is sanitised on write and on read: only an in-app path survives. Anything else
  (off-origin, a scheme, a backslash or control character, a dot segment that resolves to `//…`, a path that percent-decodes to `//…` or a backslash or fails to decode,
  over 2048 chars, not a string) is ignored, not refused: the link is still sent and lands on `/`. A link to `/` carries no `redirect` parameter.

### Timing

`silent` makes the response body the same for every address, not the response time. A known,
allowed address costs a token write and a mail send (roughly 100–300 ms), while an unknown one
returns after the lookup, so a patient caller can still tell them apart. The per-email limit
(5/hour by default) caps probes per address, and the per-IP limits only help once `clientIp` is
right. A public host that must hide membership sets `minResponseMs` above the mail path's p99, so
every request answers no sooner than that. It costs that latency on every request and a send slower
than the floor still shows; mailing from a queue (e.g. SQS) closes the gap fully. `reject` discloses
membership by design.

### Host wiring

```ts
const auth = createMagicLinkAuth<Customer, Me, Options>({
  users: { findByEmail: repo.getByEmail, findById: repo.getById },
  magicTokens,
  sessions,
  rateLimiter,
  mailer: { send: (m) => mail.send([m.to], m.subject, m.text, m.html) },
  jwt: { accessSecret, refreshSecret, issuer: 'my-api', audience: 'my-app' },
  magicLink: { baseUrl: 'https://app.example.com' },
  email: { subject: 'Sign in', intro: 'Use the link below to sign in:', linkLabel: 'Sign in' },
  toMe: (u) => ({ id: u.id, email: u.email }),
})

// one Lambda per route
const handlers = createAuthHandlers(auth, { corsHeaders, clientIp: { trustedProxyHops: 0 } })
export const verifyMagicLink = handlers.verifyMagicLink
```

A host with its own controller envelope takes the bare routes instead and wraps each `handle` itself,
honouring `fallbackResponse` and `clearCookiesOn401`:

```ts
const routes = createAuthRoutes(auth, { corsHeaders, clientIp: { trustedProxyHops: 0 } })
```

### Client IP

The per-IP rate limits key on the client IP. Everything left of the hops you trust in
`X-Forwarded-For` is client-supplied, so `clientIp.trustedProxyHops` must count exactly the proxies
you run in front of API Gateway:

| Topology                                              | `trustedProxyHops`                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Regional API Gateway, called directly                 | `0`                                                                                   |
| Edge-optimized API Gateway, called directly           | `0`: AWS's own edge hop is already folded into `sourceIp` (confirm in a dev stage)    |
| CloudFront → API Gateway (regional or edge-optimized) | `N`, measured: log `X-Forwarded-For` and `sourceIp` in a dev stage and count our hops |

Precondition for any `N > 0`: the `execute-api` endpoint must not be reachable directly, or a
caller who bypasses CloudFront forges the whole chain. `0` stays spoof-proof either way, at the cost
of keying every user behind one CloudFront edge on that edge's IP.

With `0`, the routes log one warning per `createAuthRoutes` instance when the leftmost
`X-Forwarded-For` entry differs from `sourceIp`
(`X-Forwarded-For names a client other than sourceIp; check clientIp.trustedProxyHops`, data
`{ forwardedCount }`): that is what a CloudFront in front looks like. A spoofed header triggers it
too.

### Caching

`/me`, verify and refresh answer per user, so no cache may keep them. The CloudFront behaviour in
front of the auth routes must use the managed `CachingDisabled` cache policy, or a policy with
MinTTL = 0: with MinTTL above 0, CloudFront caches a response despite `Cache-Control: no-store`
([CloudFront: managing how long content stays in the cache](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)).
The `no-store` the engine sets is defence in depth, not the control.

A host with its own controller envelope (bare `createAuthRoutes`, no `toLambdaHandler`) gets
`no-store` on every route response, and adds `Cache-Control: no-store` to its own error responses.

### Store contract kit

The types cannot say that a consume is single-use or a rotation atomic, and an in-memory fake cannot
race. `@wl/auth-be/testing` exports those rules as cases that need no test runner: each is
`{ name, securityCritical, run(makeStore) }`, and `run` rejects with `Store contract: …` when the
store breaks the rule. Every case uses fresh random emails, ids and keys, so it can run against a
shared dev database. Run them in the host's suite against the real adapter and database:

```ts
import { magicTokenStoreContract, rateLimiterContract, sessionStoreContract } from '@wl/auth-be/testing'

describe('session store', () => {
  for (const c of sessionStoreContract) it(c.name, () => c.run(makeMongoSessions))
})
```

The security-critical cases (`securityCritical: true`); a store that fails one lets a stolen or
replayed token through:

| Case                                                                               | What a failure means                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `10 concurrent consumes return the token exactly once`                             | One link signs in more than once.                            |
| `release after a newer token for the same email leaves the old one dead`           | A superseded link comes back to life after a failed sign-in. |
| `10 concurrent rotates of one id: exactly one wins and one successor row exists`   | One refresh token forks into several live sessions.          |
| `findByTokenHash returns a revoked row with revokedAt set`                         | A replayed token reads as unknown, and reuse goes unnoticed. |
| `after rotate, the old row is returned with revokedAt set`                         | A rotated token still refreshes.                             |
| `findSuccessor returns the successor while findByTokenHash(old) still returns old` | A replay is a plain 401 and the thief's session lives on.    |

## Known residual risks

Accepted on purpose; each has what a host does about it.

| Risk                                                                                                                                                                                                                                    | What the host does                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookies are fixed at `HttpOnly; Secure; SameSite=Lax`, host-only. Safari refuses a `Secure` cookie on `http://localhost`; Chrome and Firefox accept it there.                                                                           | Develop locally in Chrome or Firefox, or over https.                                                                                                                                                             |
| Anyone can spend a victim's per-email budget (5 links/hour): in `silent` mode the caller sees OK and the victim gets nothing. Keying by email + IP would reopen mail bombing from rotating IPs.                                         | Tune `rateLimits` if it bites. Rate-limit warnings log the raw client IP, on purpose.                                                                                                                            |
| Login CSRF on verify: an attacker can make a victim's browser redeem the attacker's link and land in the attacker's account. Low impact on invite-only tools: it needs an allowed account, and the victim sees the attacker's identity. | Nothing: accepted for invite-only tools.                                                                                                                                                                         |
| The raw link token rides in a GET query string (to the SPA, then `GET verify`), so it can land in CloudFront or API Gateway access logs. It is single-use, hashed at rest, and dies in 15 min (72 h for an invite).                     | Keep query strings out of CloudFront standard logs, or restrict who reads them.                                                                                                                                  |
| FE: a `/me` failure that is not a 401 (5xx, network) settles `unauthenticated`, so a blip sends the user to sign-in with valid cookies. Fail-closed by design.                                                                          | Nothing: the cookies are still valid, so a reload once the API answers restores the session.                                                                                                                     |
| Email matching: the engine lower-cases the address, then calls `findByEmail(lowercased)`. A row stored as `Ada@example.com` never matches.                                                                                              | Store emails lower-cased, or look them up case-insensitively; migrate existing rows.                                                                                                                             |
| The Lambda adapter reads API Gateway REST (v1) events only.                                                                                                                                                                             | For HTTP API (v2), call the engine directly (see [Extending](#extending)).                                                                                                                                       |
| `rateLimits.keyPrefix` defaults to `'magic'` and also namespaces the refresh budget. The name is historical; renaming it would re-key live budgets.                                                                                     | Keep it.                                                                                                                                                                                                         |
| A de-invited user's open tab hits `authenticate` on every request until the access token expires, and each one repeats `revokeAllForUser`.                                                                                              | Make `revokeAllForUser` a single conditional update (`UPDATE … SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL`, Mongo `updateMany({ userId, revokedAt: null }, …)`), so the repeats stay cheap. |

## Layout

One folder per concern; `src/index.ts` is the only public entry (plus `src/testing/index.ts` for the
store contract kit), so files can move without touching a host.

| Path                               | Owns                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-auth.ts`, `auth-config.ts` | The composition root: the host config and `createMagicLinkAuth`, which wires `session/` and the sign-in method from it.                                                                |
| `ports.ts`                         | What the host implements: user / token / session stores, rate limiter, mailer, logger.                                                                                                 |
| `errors.ts`, `tokens.ts`           | `AuthError` and its codes; JWT signing and verifying, raw link tokens.                                                                                                                 |
| `rate-limit.ts`                    | Budgets, their defaults, and the gate every flow counts against.                                                                                                                       |
| `http/`                            | Framework-free request helpers: `headers.ts`, `cookies.ts`, `redirect.ts`.                                                                                                             |
| `session/`                         | What a session does whichever way it was opened: `session-issuer.ts` (mint, rotate), `session-service.ts` (refresh, logout, request readers), `verify-session.ts` (for a sibling API). |
| `magic-link/`                      | The sign-in method: `config.ts`, `validation.ts`, `email.ts` (built-in template), `sender.ts` (mint + mail), `magic-link-flows.ts` (request, invite, verify).                          |
| `lambda/`                          | The API Gateway adapter: `client-ip.ts`, `cors-headers.ts`, `routes.ts`, `handler.ts`. Nothing outside it knows about Lambda.                                                          |
| `testing/`                         | The store contract kit (`@wl/auth-be/testing`): no runner, no dependency.                                                                                                              |
| `e2e-login.ts`                     | The test-only sign-in, built on `issueSession`.                                                                                                                                        |

Tests sit in the `__tests__/` beside the code they cover; the in-memory stores and the sign-in round
trip they share are in `src/__tests__/helpers/`. `pnpm run test-report` enforces 100% coverage.

### Extending

- Another storage, mailer or rate limiter: implement the interface in `ports.ts`; nothing else changes.
- Another transport (Express, Fastify, API Gateway v2): call the engine's methods directly, the way
  `lambda/routes.ts` does. Only `lambda/` reads a Lambda event.
- Another way to sign in: resolve the user your own way, then call `auth.issueSession(user, meta, ctx)`
  for the same cookies and session row. `e2e-login.ts` is the worked example.
- Host-specific behaviour goes through config (`isAllowed`, `rolesOf`, `onSignIn`, `validate`,
  `renderEmail`, `createError`), never through a fork of the engine.
