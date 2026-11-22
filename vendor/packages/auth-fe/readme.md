# @wl/auth-fe

Headless magic-link and (optional) Google authentication for React: the API client, the session store, the single-flight
`fetchMe` with a silent refresh-then-retry on 401, verify, logout, the Google sign-in redirect, `safeRedirect`, a provider with
hooks, and render-prop containers for the sign-in form, the verify page, the user menu and an auth
guard. It renders no markup of its own — every visible piece (form, spinner, menu, access-denied
screen) is the host's, passed in through `render` props, and navigation reaches the host only as
callbacks (`onAuthenticated(target)`, `onVerified(target)`, `onUnauthenticated()`, `onLoggedOut()`).
The package imports nothing from `apps/*` or `packages/*` and has no runtime dependencies — it is
meant to be copied into another project as-is (see "Portability contract").

A host typically wires it in one `src/features/auth/` folder: `services.ts` builds the app's store;
the containers wire the router, toasts and the app's UI components into the package containers.

## Public API

Root barrel (`src/index.ts`, re-exporting `src/features/auth/index.ts`):

- `createAuthClient<TUser>(options)` → `AuthClient<TUser>` (`services/api.ts`). Plain `fetch`,
  JSON bodies, `credentials: 'same-origin'` by default. Options:
  - `paths: { requestMagicLink, verifyMagicLink, me, refresh, logout }` — required.
  - `paths.googleStart` — optional: the API's Google start route. Unset means Google sign-in is off.
  - `navigate(url)` — performs the full-page Google redirect; default `window.location.assign`,
    looked up at call time (a test passes a stub).
  - `baseUrl` (default `''`), `fetch` (default the global, looked up at call time so a stub installed
    later is still used), `credentials`.
  - `refresh` — replaces the client's own `POST paths.refresh`. A host that refreshes from more than
    one place passes its single-flight refresh here: two concurrent refreshes present the same refresh
    token twice, and a backend with reuse detection then revokes the session.

  Contract: `requestMagicLink` and `logout` reject on any non-2xx / network failure; `me` rejects with
  an `AuthHttpError` (`status`, `type` = the error body's `type`); `refresh` resolves a boolean and
  never rejects; `verifyMagicLink(token)` never rejects and resolves `{ ok, redirect?, errorCode? }` —
  GET `${paths.verifyMagicLink}?token=…`, `errorCode` is the body's `type` on a non-2xx (or on a 2xx
  without `ok: true`). A JSON body is read only when the response says `application/json`; a `me`
  body that is not a JSON object rejects with `type: 'INVALID_RESPONSE'` (no refresh). GETs send no
  `content-type`; POSTs always send `application/json`. `startGoogleSignIn(redirect?)` exists only
  when `paths.googleStart` is set: it navigates to `${baseUrl}${paths.googleStart}`, adding
  `?redirect=<encoded safeRedirect(redirect)>` unless that is `/`. See [Google sign-in](#google-sign-in).

- `createAuthStore<TUser>(client, options?)` → `AuthStore<TUser>` (`services/main.ts`). A
  framework-agnostic external store: `getState()`, `subscribe(listener)`, and the actions
  - `submitEmail({ email, redirectUrl? })` — trims and lower-cases the email, toggles
    `requestLoading`, clears `requestError` on start, sets `sentToEmail` on success or `requestError`
    (`options.requestErrorText`, default `DEFAULT_REQUEST_ERROR_TEXT`) on failure; resolves
    `{ ok, email }`. An overlapping submit of the same (normalised) email shares the in-flight request,
    so a double click mails one link.
  - `resetSentEmail()`.
  - `fetchMe()` — concurrent callers share one in-flight request; on a 401 it calls
    `client.refresh()` once and retries `/me` once; ends `authenticated` with the user, or `unauthenticated`
    with `null`; `isSessionLoading` is true while it runs.
  - `verify(token)` — on success loads the user through `fetchMe` before resolving (a `/me` already
    in flight is awaited, then repeated with the new cookies; a `logout` meanwhile skips the load), so
    `authenticated` is never published without a user; returns the client's result. Concurrent calls
    with the same token share one request, so StrictMode's double effect does not spend the link twice.
  - `logout()` — always ends `unauthenticated` + `null`, even when the request fails; a `/me` sent
    before it never publishes.
  - `refresh()` — the client's refresh.
  - `startGoogleSignIn?(redirect?)` — the client's, present only when `paths.googleStart` is set.

  `options.initialState` seeds any part of `AuthState` (tests, SSR hydration).

- `AuthState<TUser>`: `status` (`'unknown' | 'authenticated' | 'unauthenticated'`), `user`,
  `requestLoading`, `sentToEmail`, `requestError`, `isSessionLoading`.
- `AuthProviderContainer` (`{ store, children }`; also exported as `AuthProvider`), `useAuthStore<TUser>()` (the store, for its actions; throws
  outside a provider) and `useAuth(selector?)` (`useSyncExternalStore` over the store; the server
  snapshot is the same read). Return a primitive or a stored reference from `selector`.
- Containers (`containers/`), all render-prop and headless:
  - `AuthFormContainer({ redirect?, onAuthenticated, authError?, render })` — resolves an `unknown` session with
    `fetchMe`; once `authenticated`, calls `onAuthenticated(safeRedirect(redirect))`. `render` gets
    `{ status, loading, sentToEmail, error, onSubmit({ email }), onUseDifferentEmail, google, authError }`;
    `onSubmit` sends `redirectUrl: safeRedirect(redirect)` and resolves `{ ok, email }` (toast it in the
    host). `google` is `{ onStart }` when the store has `startGoogleSignIn`, else `null`; `authError`
    is the parsed `authError` prop (below). The container also takes `authError?`: the router's
    `auth_error` search param.
  - `AuthVerifyContainer({ token?, redirect?, onVerified, render })` — no token → `error`; otherwise
    `loading` → `verify` (which loads the user) → `onVerified(safeRedirect(response.redirect ?? redirect))`,
    or `error` when the token fails or no user was loaded. `render(state)` with `'idle' | 'loading' | 'error'`.
  - `UserMenuContainer({ onLoggedOut, render })` — `null` unless authenticated with a user; `render`
    gets `{ user, onLogout }`, and `onLogout` logs out then awaits `onLoggedOut()`.
  - `RequireAuthContainer({ onUnauthenticated, onLoggedOut, fallback, isAllowed?, renderDenied?, children })`
    — resolves an `unknown` session; calls `onUnauthenticated()` once it is `unauthenticated`; renders
    `children` for a user `isAllowed` accepts, `renderDenied({ user, onLogout })` for one it rejects
    (the children never mount), and `fallback` otherwise.

  Host callbacks are read through a ref, so an inline arrow does not re-run a container's effect (and
  re-navigate) on every render.

- `safeRedirect(value?)` — the value when it is a string and an in-app path (`/…`, not `//…`, no backslash,
  `:` or control character, no dot segments that resolve to `//…`, no percent-decoded path that starts with `//` or holds a backslash or fails to decode, at most 2048 characters), else `'/'`. Browsers read `/\evil.com` as `//evil.com`.
- `parseAuthRedirectError(value)` — the `auth_error` value as an `AuthRedirectError`, or `null` for
  anything else (unknown text, a non-string).
- `AuthHttpError`, `isUnauthorized(error)` (duck-typed on `status === 401`, so a custom `AuthClient`
  only has to throw something carrying `status`), `DEFAULT_REQUEST_ERROR_TEXT`.
- Types: `AuthClient`, `AuthClientOptions`, `AuthPaths`, `AuthStore`, `AuthStoreOptions`, `AuthState`,
  `AuthStatus`, `AuthRedirectError`, `AuthProviderProps`, `AuthFormContainerProps`, `AuthFormRenderProps`,
  `AuthVerifyContainerProps`, `AuthVerifyState`, `UserMenuContainerProps`,
  `RequireAuthContainerProps`, `SessionRenderProps`, `MagicLinkRequest`, `MagicLinkResult`,
  `VerifyMagicLinkResult`.

Usage:

```tsx
const authStore = createAuthStore(createAuthClient<User>({ paths: AUTH_PATHS }))

// root
;<AuthProviderContainer store={authStore}>{children}</AuthProviderContainer>

// sign-in page
;<AuthFormContainer
  redirect={redirect}
  onAuthenticated={(to) => navigate({ to, replace: true })}
  render={(form) => (form.status === 'unauthenticated' ? <SignInForm {...form} /> : <Spinner />)}
/>
```

## Google sign-in

Off until the host sets `paths.googleStart`; with it unset nothing about Google appears (`form.google`
is `null`). The flow is a full-page navigation: the button calls `form.google.onStart`, the API
redirects to Google and back, sets the same session cookies as a magic link and lands the browser on
the page named by `redirect`. On failure it lands on the API's `errorPath` (default `/auth/sign-in`)
with `?auth_error=<reason>`, plus `&redirect=…` when there was one.

```tsx
const authStore = createAuthStore(
  createAuthClient<User>({ paths: { ...AUTH_PATHS, googleStart: '/api/v1/auth/google/start' } }),
)

// sign-in page: `auth_error` is the router's search param
;<AuthFormContainer
  redirect={redirect}
  authError={auth_error}
  onAuthenticated={(to) => navigate({ to, replace: true })}
  render={(form) => (
    <>
      {form.authError && <p>{AUTH_ERROR_TEXT[form.authError]}</p>}
      <SignInForm {...form} />
      {form.google && <button onClick={form.google.onStart}>Continue with Google</button>}
    </>
  )}
/>
```

`authError` is one of five reasons, the same list the API appends (see the `@wl/auth-be` readme):

| `AuthRedirectError` | Show                                                     |
| ------------------- | -------------------------------------------------------- |
| `cancelled`         | The user closed Google's screen: usually nothing.        |
| `invalid_state`     | The attempt expired or came from another tab: try again. |
| `not_allowed`       | This Google account may not sign in here.                |
| `rate_limited`      | Too many attempts: wait a little.                        |
| `failed`            | Something went wrong: try again, or use the email link.  |

The copy is the host's. Once the message is shown, the host should drop `auth_error` from the URL
(`navigate({ replace: true })` without it), or a reload shows it again. An unknown value renders as
`authError: null`.

**Native apps.** Google refuses OAuth in embedded user agents, so a Capacitor or other WebView build
cannot use this flow: the sign-in ends on a Google error page. Do not render the button there (leave
`googleStart` unset in the native build, or skip `form.google`); use the magic link, or a
system-browser flow of the host's own.

## Portability contract

- No runtime `dependencies`; `react` (>= 19: the provider renders `<Context value>`) is the only peer.
  Zero imports from `apps/*` or `packages/*`; the devDependencies (`@wl/eslint-config`,
  `@wl/vitest-config`, vitest) are this repo's tooling and not needed by a copy.
- Nothing app-specific lives here: API paths, the user type, the refresh strategy, the error text, the
  admin rule and every component come from the host.
- No styles and no class names — a host needs no stylesheet import and no Tailwind `@source`.
- The API it expects: cookie sessions (no tokens in JS), `POST requestMagicLink { email, redirectUrl? }`,
  `GET verifyMagicLink?token=` → `{ ok: true, redirect? }` (sets the cookies), `GET me` → the user
  object unwrapped, `POST refresh`, `POST logout`; error bodies `{ type, message }`. With Google on:
  `GET googleStart?redirect=` answers a 302 to Google and a failed sign-in comes back as
  `?auth_error=<reason>` on the sign-in page.
- Relative imports carry `.js`, so `tsc -b` output runs under Node ESM as well
  as a bundler.

To verify a copy (not automated):

1. New Vite + React 19 app; copy `vendor/packages/auth-fe/src` and `tsconfig*.json`.
2. `tsc --noEmit` clean.
3. Build a store against your API, mount `AuthProviderContainer`, render `AuthFormContainer` and
   `AuthVerifyContainer` with your own form and navigation; sign in end to end.

## Layout

- `src/features/auth/services/` — `api.ts` (the client), `main.ts` (the store), `libs.ts` (`safeRedirect`, `parseAuthRedirectError`).
- `src/lib/` — `auth-context.ts` (context + hooks), `use-latest.ts`, `use-logout.ts` (the `onLogout` the
  session containers share), and `auth-types.ts`, the types the hooks need (re-exported from
  `features/auth/types.ts`).
- `src/features/auth/containers/` — `auth-provider-container.tsx` and the four headless containers.
- `src/features/auth/__tests__/` — client, store, `safeRedirect` and container tests (browser mode).
  `pnpm run test-report` enforces 100% coverage.

## Commands

```bash
pnpm --filter @wl/auth-fe run build        # tsc -b → dist (apps consume dist: rebuild after edits)
pnpm --filter @wl/auth-fe run ts-check
pnpm --filter @wl/auth-fe run eslint-check
pnpm --filter @wl/auth-fe run test
```
