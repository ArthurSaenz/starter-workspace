# @wl/ai-chat-fe

A declarative, isolated CopilotKit react-core v2 chat feature: `<AIChat>` takes a runtime URL, an
agent id and a handful of data props; the consumer brings its own preset (the client's `/chat` one,
`NOMADREAM_PRESET`, lives in `apps/client/ui/src/features/chat/services/constants.ts`). The package
imports nothing from `apps/*` or `packages/*`, ships no product value, and its runtime dependencies
are listed under "Dependencies" — it is meant to be copied into another project as-is (see
"Portability contract"). Consumers must import it
client-only (the `@copilotkit/react-core/v2/styles.css` side-effect import breaks SSR / prerender)
and mount it only for a signed-in traveller — the runtime answers 401 otherwise. Backend design
notes: `apps/ai/ARCHITECTURE.md`.

**Where the feature catalogue lives.** Every CopilotKit v2 capability the package exposes, wraps,
blocks or leaves out is a row of `src/features/catalogue/services/registry.ts` — the single source
of truth. It feeds three views: the Storybook sidebar (`ai-chat/Catalogue` page + one
`ai-chat/<Area>/<Feature>` entry per row), the generated block under "Feature catalogue" below, and
the per-file guards (`features.test.ts`, `storybook-check`). To browse it:
`pnpm --filter @wl/ai-chat-fe storybook` → http://localhost:3003 → sidebar `ai-chat/<Area>/<Feature>`.
Each feature's Docs page reads: what it is (title + summary), the seam a consumer flips
(`features.*`, `chat.*`, `provider.*`, a top-level prop, or the CopilotKit hook to call from
`children`), the status, the caveat, and — for blocked rows — what the backend still needs.

Status tags (the `status:<tag>` badge on every stories file, pinned to the registry by
`features.test.ts`):

| Tag                                    | Meaning                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on`                                   | Works with the shipped defaults.                                                                                                                                                                                                                                                                               |
| `on-with-caveat`                       | Works, with a documented limitation in the row's caveat.                                                                                                                                                                                                                                                       |
| `off-by-default`                       | Works once a consumer sets the seam; the stories set it.                                                                                                                                                                                                                                                       |
| `backend-blocked` (`blockedBy: [...]`) | The FE path exists but the ai-api Lambda does not serve it. `lambda-route` = not on the Lambda allow-list (e.g. `/threads/:id/*`, which answers 404); `lambda-backend` = adapter / graph / service missing (MCP Apps); `license` = CopilotKit Intelligence; `transport` = the buffered (non-streaming) Lambda. |
| `out-of-scope`                         | Deliberately not adopted (cloud, license, dev-only bypasses, headless UI); an `Overview` story explains why.                                                                                                                                                                                                   |
| `not-applicable`                       | Nothing to show; no stories file (`hasStoriesFile` is false).                                                                                                                                                                                                                                                  |

Two story shapes carry extra meaning. A `FakeOnly_*` story exists only for a `lambda-backend` block:
the fake supplies a frame or `/info` flag the Lambda never sends (`parameters.catalogue.fakeSupplies`
names it, e.g. `/info openGenerativeUIEnabled`)
so the FE rendering is demonstrable — the status never upgrades because the fake made it work. A
`deniedRoute` story (`parameters.catalogue.deniedRoute`, e.g. `/threads/:id/messages`,
`/agent/:id/suggest`) is the only kind allowed for a `lambda-route` / `license` / `transport` block: it
asserts the request left, landed in `runtime.denied` with the Lambda's `NOT_FOUND_BODY`, and what the
traveller saw. `features.test.ts` enforces both rules.

## Public API

Root barrel (`src/index.ts`, re-exporting `src/features/ai-chat/index.ts` plus `lib/runtime-url.ts`):

- `AIChat` — the component (`containers/ai-chat-root-container.tsx`, exported under its lint-facing
  name `AIChatRootContainer` inside the feature and as `AIChat` at the barrel). Props: `AiChatProps`.
- `defineAiChat(props)` — identity with inference; keeps a preset literal fully typed.
- `resolveAiChat(props, preset?, id?)` → `ResolvedAiChat` — the merge (below); what `AIChat` hands to
  `CopilotKitProvider` / `CopilotChatConfigurationProvider` / the surface.
- `AI_CHAT_TOKENS` (the 33 CopilotKit token names, `AiChatToken`) and `themeCss(id, theme)`.
- `describeChatFailure(event, text?)` → `ChatFailure` and `ChatFailureComponent` (the red line).
- `agentProgressRenderers(options?)` → `provider.renderActivityMessages` entries that render the
  Lambda's `agent-progress` activity as `AgentProgressLine` while a run is under way
  (`options.labels`, `options.activityType`; `AGENT_PROGRESS_ACTIVITY_TYPE`).
- `useAwaitingToolCall()` / `useAwaitingInterrupt(agentId?)` — the two "the agent is waiting for the
  traveller" flags a custom composer holds its send on (FINDING-4 and FINDING-5).
- `AIChatContainer` — **a preset over `<AIChat>`, not a second API**: it spreads its required
  `preset` prop, merges a consumer's `chat` over `resolveAiChat(preset).chat`, and turns `userName`
  into one `context` entry. `AIChatOverrides` is `@deprecated` in favour of `AiChatProps['chat']`. No
  app uses the container; the tests and three stories mount it.
- `AI_CHAT_RUNTIME_URL` — single-sourced runtime path.
- Types: `AiChatProps`, `AiChatPreset`, `AiChatProviderProps`, `AiChatChatProps`, `AiChatSurface`,
  `AiChatFeatures`, `AiChatTheme`, `AiChatToken`, `AiChatSuggestion`, `AiChatSuggestionAvailability`,
  `ChatFailure`, `ChatFailureKind`, `ChatFailureEvent`, `ChatFailureText`, `ChatFailureLineProps`,
  `ResolvedAiChat`, `AIChatContainerProps`, `AIChatOverrides`.

Other entries (`package.json` `exports`; `src/__tests__/public-exports.test.ts` pins every name):

- `@wl/ai-chat-fe/copilotkit` — CopilotKit's own `useAgent`, `UseAgentUpdate`, `useCopilotKit`,
  `useFrontendTool`, `useHumanInTheLoop`, `useInterrupt`, `useCapabilities`, unwrapped, for code mounted
  inside `AIChat`'s provider. Exception E1 of the chat dependency rule (below).
- `@wl/ai-chat-fe/preset` — the light entry: `AI_CHAT_RUNTIME_URL` only, nothing that loads CopilotKit, so
  a consumer's preset module can be read by a page that has not loaded the chat.
- `@wl/ai-chat-fe/markdown` — `SafeMarkdown` and its link rules (`toSafeLink`, `isTrustedHost`,
  `TrustedHostsContext`, the chains' `CHAIN_DOMAINS`), without CopilotKit.
- `@wl/ai-chat-fe/styles.css` — the layout stylesheet (Portability contract).

### `<AIChat>` props (`src/features/ai-chat/types.ts`, resolved in `services/config.ts`)

| Prop                    | Kind                         | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runtimeUrl`, `agentId` | required                     | Written on the provider, on `CopilotChat` and on the `CopilotChatConfigurationProvider`, so `useAgent` / `useSuggestions` / `useCopilotChatConfiguration` in `children` resolve to the same agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `provider.*`            | forwarded 1:1                | `AiChatProviderProps = Pick<CopilotKitProviderProps, 'headers' \| 'credentials' \| 'properties' \| 'debug' \| 'frontendTools' \| 'humanInTheLoop' \| 'renderToolCalls' \| 'renderCustomMessages' \| 'renderActivityMessages' \| 'enableInspector'>`. Defaults: `credentials: 'same-origin'`, `enableInspector: false`. The pick is exhaustive at runtime too (`PROVIDER_KEYS`): a key a loosely-typed preset smuggles in never reaches the provider.                                                                                                                                                                                                                                             |
| `chat.*`                | forwarded 1:1, merged        | `AiChatChatProps = Omit<Partial<CopilotChatProps>, 'agentId' \| 'onError' \| 'onSubmitMessage' \| 'isModalDefaultOpen' \| 'inspectorTools' \| 'chatView'>` — labels, slots (`input`, `messageView`, `suggestionView`, `scrollView`, `welcomeScreen`), `threadId`, `autoScroll`, `attachments`, class names… Merged over the preset by the rule below; the six reserved keys are stripped even if present at runtime. The view itself is always CopilotKit's (no `chatView`); for your own UI next to it use `children` with `useAgent` / `useCopilotKit`.                                                                                                                                        |
| `surface`               | forwarded 1:1 (surface-only) | `{ kind: 'inline' }` (default) renders `CopilotChat` in place; `{ kind: 'sidebar', header?, toggleButton?, defaultOpen?, open?, onOpenChange?, width?, position? }` and `{ kind: 'popup', …, height?, clickOutsideToClose? }` render CopilotKit's launcher surfaces, which take every `chat.*` prop. Named picks, not `Omit<…, keyof CopilotChatProps>`: `CopilotChatViewProps` has a string index signature, so that `keyof` is `string`.                                                                                                                                                                                                                                                       |
| `features.welcome`      | wrapped                      | `false` → `chat.welcomeScreen = false`; a string → `labels.welcomeMessageText` (and undoes a lower layer's `false`); a component → the `welcomeScreen` slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `features.disclaimer`   | wrapped                      | `false` → `chat.input.disclaimer = NoDisclaimer` (CopilotChatView hard-codes `showDisclaimer: true`; a null slot is the only way to drop the "AI can make mistakes" line); a string → `labels.chatDisclaimerText`; a component → the `input.disclaimer` slot. Merged into the same `input` object as a consumer's `toolsMenu` / `autoFocus`.                                                                                                                                                                                                                                                                                                                                                     |
| `features.suggestions`  | wrapped                      | `AiChatSuggestion[]` or `{ items, available? }` → one `useConfigureSuggestions({ suggestions, available: 'before-first-message' by default, consumerAgentId: agentId })` registrar (FINDING-1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `features.errorLine`    | wrapped                      | `true` (default) renders `ChatFailureComponent` under the surface; `false` renders nothing; an `FC<{ failure }>` replaces it; `{ text: Partial<Record<ChatFailureKind, string>> }` re-words it per kind (the `text` argument of `describeChatFailure`).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `features.feedback`     | wrapped                      | `{ onThumbsUp?, onThumbsDown? }` → `chat.messageView.assistantMessage.onThumbsUp/Down`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `context`               | wrapped                      | `readonly AgentContextInput[]`; one `useAgentContext` registrar per entry. CopilotKit stringifies non-string values on the wire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `theme`                 | wrapped                      | `{ tokens?: Partial<Record<AiChatToken, string>>, dark?: boolean, scope?: 'chat' \| 'host' }`. Only set keys are emitted, as a `<style>` inside the wrapper. `scope: 'chat'` (default) → `[data-ai-chat="<id>"] [data-copilotkit]{…}` — reaches the roots inside the wrapper only; CopilotKit's portals (tooltips, dropdowns, the tools menu) mount at `<body>` with their own `[data-copilotkit]` root and stay unthemed. `scope: 'host'` → `[data-copilotkit][data-copilotkit]{…}` (specificity (0,2,0), beats CopilotKit's own `.dark [data-copilotkit]`) — every chat and every portal in the document. `dark` adds `.dark` to the wrapper; the portals need `.dark` on the host's `<html>`. |
| `onError`               | wrapped                      | `(failure: ChatFailure, event: ChatFailureEvent) => void`, fired after the package's own line is set; the raw provider event rides along for logging. The package owns the provider `onError` (chat-scoped handlers miss the `/info` handshake failure).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `className`             | wrapped                      | On the wrapper `<div data-ai-chat data-testid="ai-chat">` (through `cn()`, together with `dark`). The host bounds the height here — the chat is `height: 100%` of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `children`              | —                            | Rendered inside the provider and the configuration context, before the surface: the place for `useFrontendTool` / `useHumanInTheLoop` / `useCopilotChatConfiguration` / `useAgent` / `useSuggestions` consumers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Deep-merge rule** (`resolveAiChat` JSDoc, tested in `__tests__/config.test.ts`):

> Turns the declarative props (and an optional preset underneath them) into what the CopilotKit
> primitives take. Merge rule: `chat.labels` and every object-form slot on `chat` (`input`,
> `messageView`, `suggestionView`, `scrollView`, `welcomeScreen`) merge key by key over the preset; a
> string or component replaces the slot; `undefined` keys are dropped first and never erase a preset
> value. `provider`, `features` and `theme` merge shallowly under the same rule (`theme.tokens` key by
> key). Layering: each layer's `features` are applied to that layer's `chat` before the next layer
> merges over it, so a consumer's `chat.input.disclaimer` beats the preset's
> `features.disclaimer: false`, and the consumer's own `features` are applied last. `agentId` is
> written on the provider, the chat and the configuration context; `credentials` defaults to
> `same-origin`, `enableInspector` to `false`. `id` is the wrapper's `data-ai-chat` value the theme
> CSS is scoped to.

The layering differs from the plan's literal shape on purpose: applying every `features` after the
whole `chat` merge would have made the preset's `disclaimer: false` beat a consumer's explicit
`chat.input.disclaimer` (the `WithDisclaimerOverride` regression).

**Not exposed, and why** (`config.test.ts` pins that none of them reach CopilotKit even when a
preset object carries them):

| Key                                                                           | Why                                                                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider.agents__unsafe_dev_only`, `provider.selfManagedAgents`              | In-browser agents bypass the runtime and its session gate.                                                                                     |
| `provider.publicApiKey`, `provider.publicLicenseKey`, `provider.licenseToken` | Copilot Cloud / Intelligence — no cloud, no license.                                                                                           |
| `provider.showDevConsole`                                                     | Superseded by `enableInspector`.                                                                                                               |
| `provider.useSingleEndpoint`, `provider.defaultThrottleMs`                    | Legacy single-route transport; render throttle is a streaming knob and the Lambda buffers.                                                     |
| `chat.onError`, `chat.onSubmitMessage`                                        | The error channel is the package's (provider-level); `onSubmitMessage` is silently overridden by CopilotChat's internal handler.               |
| `chat.isModalDefaultOpen`, `chat.inspectorTools`                              | The modal-owner flag belongs to the launcher surfaces (`surface.defaultOpen`); the per-message inspector shortcuts are local-development only. |

### Minimal usage

A host project (any Vite + React app; see "Portability contract" for the three imports):

```tsx
import { AIChat } from '@wl/ai-chat-fe'
import '@wl/ai-chat-fe/styles.css'

export const Support = () => {
  return (
    <AIChat
      runtimeUrl="/api/copilotkit"
      agentId="supportAgent"
      provider={{ headers: { Authorization: `Bearer ${token}` } }}
      features={{
        welcome: 'How can I help?',
        disclaimer: false,
        suggestions: [{ title: 'Track an order', message: 'Where is my order?' }],
      }}
      theme={{ tokens: { primary: 'oklch(0.45 0.2 260)' }, scope: 'host' }}
      onError={(failure, event) => report(event.code, failure.kind)}
      className="h-[600px]"
    />
  )
}
```

A consumer page with its own preset (the client spreads `NOMADREAM_PRESET` from its
`features/chat/services/constants.ts` the same way):

```tsx
<AIChat {...MY_PRESET} context={[{ description: 'Name of the signed-in traveller', value: user.name }]} />

// or through the container:
<AIChatContainer preset={MY_PRESET} userName={user.name} />
```

The product's own words and hosts come in as props: `failureText` re-words a failed turn per kind (the
package's defaults name no product), `trustedHosts` lists the consumer's own hosts, whose links in a
reply keep their path and query and show no host label (empty by default; `SafeMarkdown` takes the same
prop).

## Portability contract

- **Dependencies** (`package.json` `dependencies`; `react` / `react-dom` are peers):
  `@copilotkit/react-core` and `@copilotkit/a2ui-renderer` (`catalog:copilotkit`, the exact version the
  runtime in `@wl/ai-chat-be` runs), `streamdown` (the reply markdown), `clsx`, `tailwind-merge`, `zod`
  (`catalog:agui`, the zod 3 AG-UI takes as a peer) and `zod-v3`. Zero imports from `apps/*` or
  `packages/*`. The only deployment value left is the runtime path in `lib/runtime-url.ts`.
- **Chat dependency rule** (`pnpm chat-deps-check`, in `pnpm gate`; allow-list in
  `devops/scripts/lib/check-chat-deps.ts`): CopilotKit and Streamdown are declared here and nowhere
  else in the browser, always as `catalog:` references. Apps import none of them; their one door is
  exception **E1**, `@wl/ai-chat-fe/copilotkit`, which passes the seven hooks above through unwrapped
  (wrapping 93 call sites 1:1 would be one more layer to bump), so an app's raw CopilotKit use is one
  grep for that path.
- A host must do three things:
  1. **Get `@copilotkit/react-core/v2/styles.css`.** `containers/ai-chat-root-container.tsx` imports
     it as a side effect, so a bundler that keeps CSS side effects (Vite does) needs nothing more.
     If the host's bundler drops them (`sideEffects: false` shaking, a CSS-less SSR pass), import
     it explicitly once. It is also why the package is `clientOnly` in the client: the import breaks
     SSR / prerender.
  2. **Import `@wl/ai-chat-fe/styles.css` once** (`exports["./styles.css"]` → `dist/styles.css`,
     copied from `src/styles.css` by `build`). It is structural only: `[data-ai-chat]` is a
     `display: flex; flex-direction: column; height: 100%; width: 100%` wrapper and
     `[data-ai-chat] [data-testid='copilot-chat']` gets `flex: 1; min-height: 0`. The second rule is a
     descendant selector, not a child one, because `CopilotChat` wraps its root in a
     `display: contents` div. Without this file the chat collapses to zero height (`CopilotChat` is
     `h-full` of nothing).
  3. **Add an `@source` for the package to the Tailwind entry**, exactly what
     `apps/client/ui/src/styles/globals.css:12` does: `@source '../../../../../vendor/packages/ai-chat-fe/src';`
     (line 10 is the app's own `@source '../';`). Tailwind never scans outside the app, and the
     package's cosmetic utilities (the error line's `px-4 text-red-700 …`, the catalogue table) are
     plain class strings through `cn()`. The package Storybook does the same in
     `.storybook/tailwind.css` (`@import 'tailwindcss' source(none); @source '../src';`). A copy that
     ships `dist/` can point the `@source` at `dist` instead.
- **A non-Tailwind host loses only those cosmetics** (the error line renders as unstyled text, the
  catalogue table as an unstyled table). The chat itself is styled by CopilotKit's stylesheet and the
  layout by `styles.css`; nothing functional depends on a utility.
- Not adopted: `components/ui` (shadcn) — the build is `tsc -b` with no `#root` alias, so the shadcn
  CLI's alias imports would ship verbatim into `dist/`.

To verify a copy (the copy test; not automated):

1. New Vite + React app; add `react`, `react-dom` and the "Dependencies" above (CopilotKit at the
   same exact version as `catalog:copilotkit`).
2. Copy `vendor/packages/ai-chat-fe/src` and `tsconfig*.json`; point `src/lib/runtime-url.ts` at the new
   runtime.
3. Import the two stylesheets; add `@source` for the copied `src` to the Tailwind entry.
4. `tsc --noEmit` clean; render `<AIChat runtimeUrl agentId />` against a CopilotKit runtime — the
   welcome screen, the composer and (after one message) the reply render inside a bounded-height
   parent.

## Layout

The application layout (`apps/client/ui/src`), scaled to a widget package — no `app/`, `routes/` or `pages/`;
`src/index.ts` re-exports the ai-chat feature barrel and the one shared constant:

```
src/
├── index.ts                      # public API: the ai-chat feature barrel + lib/runtime-url
├── styles.css                    # structural chrome → dist/styles.css → @wl/ai-chat-fe/styles.css
├── typings/                      # css.d.ts, raw.d.ts (`?raw` for catalogue-readme.test.ts), vitest-browser.d.ts
├── components/
│   ├── default/                  # custom shared components (only a .gitkeep today)
│   └── ui/                       # shadcn components (only a .gitkeep today)
├── copilotkit/index.ts           # @wl/ai-chat-fe/copilotkit — the raw CopilotKit hooks (E1)
├── preset/index.ts               # @wl/ai-chat-fe/preset — the light entry (runtime URL)
├── markdown/                     # @wl/ai-chat-fe/markdown — SafeMarkdown, link rules
├── __tests__/public-exports.test.ts
├── lib/
│   ├── runtime-url.ts            # AI_CHAT_RUNTIME_URL — single-sourced for every chat surface
│   ├── utils.ts                  # cn()
│   └── __tests__/
├── features/ai-chat/
│   ├── index.ts, types.ts        # barrel; public + internal types
│   ├── services/                 # main.ts (barrel) + chat-failure.ts, config.ts, theme.ts
│   ├── containers/
│   │   ├── ai-chat-root-container.tsx   # AIChatRootContainer, exported as AIChat
│   │   └── ai-chat-container.tsx        # AIChatContainer = a consumer preset over AIChat
│   ├── components/chat-failure-component.tsx
│   ├── __stories__/
│   │   ├── kit/                  # define-feature-meta.ts, story-kit.ts
│   │   ├── <area>/<feature>.stories.tsx  # surfaces/ suggestions/ tools/ hitl/ context/ threads/
│   │   │                                 # composer/ messages/ theming/ runtime/ errors/ not-exposed/
│   │   └── chat-failure-component.stories.tsx  # the "Traveller error line" rows (see below)
│   └── __tests__/ (+ helpers/)   # runtime fake, stories.test.tsx runner, config/container/state tests
└── features/catalogue/
    ├── index.ts, types.ts        # barrel (adds feature-docs); Feature / Area / Seam / FeatureStatus
    ├── services/                 # main.ts (CopilotKit-free barrel), registry.ts, areas.ts, story-title.ts,
    │                             # render-markdown.ts; feature-docs.ts (react-core) is barrel-only
    ├── components/               # feature-catalogue-component.tsx, feature-card-component.tsx
    ├── __stories__/              # both titled `ai-chat/Catalogue` (same-title CSF files merge)
    └── __tests__/                # features.test.ts, catalogue-readme.test.ts, component tests
scripts/
├── render-catalogue.mjs          # `catalogue`: rewrites the README block from dist/…/services/main.js
└── check-storybook-index.mjs     # `storybook-check`: storybook-static/index.json vs the registry
.storybook/                       # main.ts, preview.tsx (storySort + fetch restore), tailwind.css
```

- `chat-failure-component.stories.tsx` stays at the feature root although its title is
  `ai-chat/Errors and observability/Traveller error line`: the `@wl/require-component-stories` lint
  wants exactly `__stories__/<component>.stories.tsx` per dumb component. (The plan had it moving
  under an area folder; the lint won.)
- `components/default` and `components/ui` hold only a `.gitkeep` each; the first real shared component
  deletes it. There is no `components.json`: the build is `tsc -b`, and the shadcn CLI writes `#root/…`
  alias imports that tsc would ship verbatim into `dist/`. Adopting shadcn here means moving to a Vite
  lib-mode build first.
- Imports are relative with the `.js` suffix — no `#root` alias in a tsc-built package, for the same reason.
- The barrel-only guard is the package `no-restricted-imports` rule (`eslint.config.js`): it blocks
  `…/features/<x>/<deep>` specifiers, but a sibling-feature _relative_ deep import
  (`../other-feature/x.js`) is unguarded — `boundaries/dependencies` cannot resolve `.js` imports here —
  so a feature imports its sibling through `../catalogue/index.js` / `../ai-chat/index.js` by
  discipline (the registry's type import and the story kit do). The same holds inside a feature for
  `services/`: importers use `../services/main.js`; the rule's `services/*/**` pattern only covers a
  nested `services/<x>/<deep>` path, so this too is discipline.
- `tsconfig.build.json` excludes `src/**/__tests__` and `src/**/__stories__` (the kit's `.ts` files
  leaked into `dist/` before that).
- Validators: `node <infra-kit>/plugins/infra-kit/skills/fe-architect/scripts/{check_structure,validate_feature}.mjs src/features/<feature>`
  and `analyze_imports.mjs src/features`, from the infra-kit dev checkout at ≥ `5825c6d`
  (`validate_feature` matches export names case-insensitively there; released infra-kit ≤ 0.11.0
  fails on the `AIChatContainer` casing). Expected: both features `check_structure` PASSED;
  `validate_feature src/features/ai-chat` PASSED with two "should handle loading state" warnings
  (the substring heuristic on both containers — CopilotChat owns its loading UI); `catalogue` 0
  warnings; `analyze_imports` "No runtime / type-only cross-feature imports found" (its patterns
  need a `features/` segment, which the relative barrel imports do not carry).

## Storybook

Storybook is the showcase of what the package can do, not a test suite. Every story opens already in
the state it shows (a closed launcher, a conversation, a custom welcome screen…) — no `play` drives
it there — and its Docs text says what the feature is and how to turn it on. Each state that matters
is its own story. The runtime fake still answers, so a story can be tried by hand. No story has a
`play`; assertions live in `src/features/ai-chat/__tests__/<area>.test.tsx`, one file per area. A
feature we cannot use (`backend-blocked`, `out-of-scope`) keeps a single `Overview` story showing its
catalogue card.

- **`SeedTranscript`** (`__stories__/kit/seed-transcript.tsx`, transcripts in `kit/transcripts.ts`) —
  put in `AIChat`'s `children` to open a story on a conversation that already happened.
- **`StartRun`** (`__stories__/kit/start-run.tsx`) — sends one turn on open (once the runtime is
  connected), so a running / streaming / failed / tool-call state shows without a play; the story's
  `parameters.runtime` scenario decides what comes back. Area helpers sit next to it in `kit/`.
- `pnpm --filter @wl/ai-chat-fe storybook` — dev server on port 3003 (3002 is the client, 3012 the
  backoffice). `storybook-build` writes `storybook-static/`.
- **Hierarchy.** `ai-chat/Catalogue` (the registry table, `features/catalogue/__stories__`), then
  `ai-chat/<Area>/<Feature>` — one file per registry row at
  `src/features/ai-chat/__stories__/<area>/<feature-id>.stories.tsx`, area folders in registry order
  (`.storybook/preview.tsx` `storySort` is a literal list, not `AREAS.map(…)`: Storybook evaluates
  it statically and rejects a spread; `features.test.ts` pins the list to the registry).
- **`defineFeatureMeta(feature, extra?)`** (`__stories__/kit/define-feature-meta.ts`) returns
  everything a stories file puts on `meta` except `title` and `tags`: `component: AIChat`,
  `args` = `NOMADREAM_PRESET` + the kit's `Ada` context entry, `loaders: [runtimeLoader]`,
  `parameters.layout: 'fullscreen'`, `docs.story.inline: false`, `docs.description.component =
featureDocs(feature)`, `catalogue.featureId`. `title` and `tags` are literals in every file —
  Storybook's CSF indexer reads both statically: a computed title crashes `storybook build`, and tags
  inside a spread are simply not seen (no autodocs page, no `status:` badge). `features.test.ts` pins
  `title === storyTitle(feature)` and `tags === ['autodocs', 'status:<status>']`. `extra` is spread
  last (`parameters` one level deep); a file that keeps a story on `AIChatContainer` passes
  `component` and `args` together.
- **The runtime fake** (`src/features/ai-chat/__tests__/helpers/`, `installRuntimeScenario(scenario)`)
  replaces `window.fetch` for `AI_CHAT_RUNTIME_URL` and answers with the real Lambda bytes
  (`lambda-bodies.ts`, `frames.ts`): `GET /info`, the run `POST`, the suggest and stop routes,
  `POST /transcribe`, and — from the scenario's kept `threads`, plus every `reply` run's thread —
  `POST /agent/:id/connect` (the replay) and `GET /threads` (the list). Everything off the Lambda
  allow-list — `/threads/:id/*`, `/threads/clear` — gets the 404 `NOT_FOUND_BODY` and lands in
  `runtime.denied`; every request lands in `runtime.requests` (`{ method, path, headers, credentials }`),
  runs in `runtime.runs`, stops in `runtime.stops`, connects in `runtime.connects`, transcriptions
  (with the multipart `audio` file) in `runtime.transcribes`. The `/info` defaults are
  pinned by `fake-runtime.test.ts` (`suggestions: true`, `audioFileTranscriptionEnabled: false`,
  `threadEndpoints.list: true`, `a2uiEnabled: true`, `openGenerativeUIEnabled: false`). A scenario's
  `transcribe` is the Lambda with `GEMINI_API_KEY`: it turns `audioFileTranscriptionEnabled` on and
  answers `/transcribe` (`{ text }`, or an error status and body); without it `/transcribe` gets the
  keyless runtime's 503. A per-scenario `info: { overrides }` is the only legitimate way to advertise
  anything else, and only a `FakeOnly_*` story — or an `off-by-default` one that names it in
  `catalogue.fakeSupplies`, as Open Generative UI's does (off in the product by decision) — may rely on it.
- Each story installs the fake from Storybook `loaders`, never from a decorator effect:
  `CopilotKitProvider` fetches `/info` from its own effect, which runs before any decorator effect
  could patch `fetch`. Storybook awaits loaders before rendering. The preview decorator only restores
  the original `fetch` on unmount (and bounds the story at 600 px — `CopilotChat` is `h-full`).
- The Docs tab renders every story in its own iframe (`docs.story.inline: false`). The fake is a
  singleton on `window.fetch`, so inline Docs stories would share — and overwrite — one scenario.
- **`stories.test.tsx`** — every stories file in the package (`import.meta.glob('../../*/__stories__/**/*.stories.tsx')`)
  is composed with `composeStories` from `@storybook/react` and every export becomes a vitest test
  (`await expect(story.run()).resolves.toBeUndefined()`; `run()` is loaders + mount, so it proves
  every story mounts). A smoke test mounts one story first so a runner without React's
  `renderToCanvas` fails visibly rather than every story failing on an empty canvas. Why not
  the generic `storybook/preview-api` entry: its `composeStory` has no `renderToCanvas`
  (`SB_PREVIEW_API_0014` at compose time). Why not `@storybook/addon-vitest`: it is not valid on
  vitest 5 in this repo. Runs under the browser project (`vitest.config.ts`: `@tailwindcss/vite`
  so utilities exist, `optimizeDeps` pins `react-core/v2` + `/v2/headless` — a cold cache otherwise
  re-optimises mid-run and collects 0 tests — and `fileParallelism: false` because every file
  installs the one `window.fetch`).
- **`features.test.ts`** guards: unique ids; every feature in a known area; `blockedBy` exactly on
  `backend-blocked` (or a license-gated `out-of-scope`); stories listed exactly for `hasStoriesFile`
  rows; titles free of `/`; every stories file titled from the registry, the catalogue or
  `LEGACY_STORY_TITLES` (empty); the listed-but-missing check gated on `EXPECT_COMPLETE` (`true`
  since Phase 4.12); exported stories ⊆ listed; `FakeOnly_` only with `lambda-backend` + named
  `fakeSupplies`; `deniedRoute` on every non-`Overview` story of a route / license / transport
  block; the `storySort` list.
- **`catalogue`** (`pnpm run build && node scripts/render-catalogue.mjs`) rewrites the block between
  the two `catalogue:start` / `catalogue:end` HTML comments and runs prettier on the file (the
  script takes the _first_ occurrence of each marker, so never spell the full comment out anywhere
  else in this file);
  `catalogue-readme.test.ts` compares the block (cell-trimmed) with `renderCatalogueMarkdown(FEATURES)`.
  **`storybook-check`** (`pnpm run build && node scripts/check-storybook-index.mjs`, after
  `storybook-build`) diffs `storybook-static/index.json` titles against `expectedStoryTitles(FEATURES)`
  and exits 1 on any difference — gating since Phase 4.12 (94/94). Both scripts import the built,
  CopilotKit-free `dist/features/catalogue/services/main.js`, never the feature barrel: plain node
  cannot load react-core's `.css` import, so `feature-docs.ts` (which reads
  `CopilotChatDefaultLabels`) is reachable only through the barrel.

## Feature catalogue

Every CopilotKit v2 capability the package exposes, wraps, blocks or leaves out, as a typed registry
(`src/features/catalogue/services/registry.ts`). Storybook renders it at `ai-chat/Catalogue`; each
feature's own stories live at `ai-chat/<Area>/<Feature>`. `pnpm --filter @wl/ai-chat-fe catalogue`
regenerates the block below from the registry and `catalogue-readme.test.ts` fails when they drift;
`pnpm --filter @wl/ai-chat-fe storybook-check` diffs the built Storybook index against the registry.
Status legend: `on`, `on-with-caveat`, `off-by-default`, `backend-blocked` (with what blocks it:
`lambda-route` = the allow-list, `lambda-backend` = adapter/graph/service, `license` = CopilotKit
Intelligence, `transport` = the buffered Lambda), `not-applicable` (no stories file), `out-of-scope`.

<!-- catalogue:start -->

_97 features in 12 areas: 43 on, 10 on-with-caveat, 27 off-by-default, 1 backend-blocked, 5 not-applicable, 11 out-of-scope. Generated from `src/features/catalogue/services/registry.ts` by `pnpm --filter @wl/ai-chat-fe catalogue` — do not edit by hand._

### Surfaces and copy

| Feature        | Summary                              | Status                                                                                                                             | Seam                  | Stories                                            |
| -------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| Inline chat    | Full-height chat in the host layout  | on                                                                                                                                 | `surface`             | `Empty`, `WithConversation`, `BoundedHeight`       |
| Sidebar        | Docked panel with launcher           | off-by-default — CopilotKit's `defaultOpen` is `true`; pass `defaultOpen: false` to start closed.                                  | `surface`             | `Closed`, `Open`                                   |
| Popup          | Floating modal chat                  | off-by-default — CopilotKit's `defaultOpen` is `true` and `clickOutsideToClose` is off; pass `defaultOpen: false` to start closed. | `surface`             | `Closed`, `Open`                                   |
| Headless hooks | Your own UI driving the chat’s agent | on                                                                                                                                 | `children (useAgent)` | `RunControls`                                      |
| Labels         | All user-facing copy                 | on                                                                                                                                 | `chat.labels`         | `CustomPlaceholder`, `CustomWelcomeAndPlaceholder` |
| Welcome screen | Empty-state greeting                 | on                                                                                                                                 | `features.welcome`    | `Default`, `Off`, `CustomComponent`                |
| Disclaimer     | Line under the composer              | on — A consumer preset may set its own line — `Default` is the preset used here; `false` drops it.                                 | `features.disclaimer` | `Default`, `Off`, `Text`, `WithDisclaimerOverride` |
| Auto-scroll    | Scroll policy                        | on                                                                                                                                 | `chat.autoScroll`     | `PinToBottom`, `None`                              |

### Suggestions

| Feature                  | Summary                               | Status         | Seam                          | Stories                                   |
| ------------------------ | ------------------------------------- | -------------- | ----------------------------- | ----------------------------------------- |
| Static pills             | Fixed pills                           | on             | `features.suggestions`        | `Default`, `AfterPillClick`               |
| Availability             | When pills show                       | on             | `features.suggestions`        | `Always`, `AfterFirstMessage`, `Disabled` |
| Agent-generated pills    | Pills generated by an agent           | on             | `features.dynamicSuggestions` | `GeneratedAfterAnswer`                    |
| Programmatic suggestions | Read and refresh pills from custom UI | on             | `children (useSuggestions)`   | `Controls`, `Cleared`                     |
| Pill rendering           | Custom pill component or classes      | off-by-default | `chat.suggestionView`         | `CustomPill`                              |

### Tools and generative UI

| Feature                  | Summary                                   | Status                                                                                                                                                                                                                                                                                                                                                                           | Seam                                              | Stories                            |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Frontend tool            | Agent calls browser code                  | on — Path proven; the product registers none. `provider.frontendTools[].render` is registered only when the tool carries `parameters` (a schema-less render is dropped silently); the hook path renders without one.                                                                                                                                                             | `provider.frontendTools`                          | `HotelCard`                        |
| Render a named tool      | UI for a backend tool call                | off-by-default                                                                                                                                                                                                                                                                                                                                                                   | `provider.renderToolCalls`                        | `LoyaltyBalanceCard`               |
| Catch-all renderer       | Render every un-rendered tool call        | off-by-default                                                                                                                                                                                                                                                                                                                                                                   | `provider.renderToolCalls`                        | `WildcardCard`                     |
| Component as tool        | React component the agent can call        | on-with-caveat                                                                                                                                                                                                                                                                                                                                                                   | `children (useComponent)`                         | `HotelSummaryCard`                 |
| Follow-up run            | Agent runs again after a result           | on                                                                                                                                                                                                                                                                                                                                                                               | `provider.frontendTools`                          | `FollowUpReply`, `NoFollowUp`      |
| Tool availability        | Hide a tool from the wire                 | off-by-default                                                                                                                                                                                                                                                                                                                                                                   | `provider.frontendTools`                          | `HiddenFromAgent`                  |
| Default tool-call chrome | How unrendered tool calls look            | on-with-caveat — A tool call with no renderer renders NOTHING (dev-only console.warn names it); the built-in card (`copilot-tool-render*`) appears only once `useDefaultRenderTool()` registers the `*` renderer.                                                                                                                                                                | `chat.messageView.assistantMessage.toolCallsView` | `NoRendererRegistered`             |
| WebMCP exposure          | Register on document.modelContext         | off-by-default                                                                                                                                                                                                                                                                                                                                                                   | `provider.frontendTools`                          | `Overview`                         |
| Universal tool-call line | One neutral status line for any tool call | on                                                                                                                                                                                                                                                                                                                                                                               | `provider.renderToolCalls`                        | `Checked`, `LookingUp`             |
| Open Generative UI       | Sandboxed HTML from the agent             | off-by-default — The backend does not enable it; the product keeps it off by decision (model-written HTML). Passing `provider.openGenerativeUI` at all switches the browser half on whatever `/info` says, so no preset passes it.                                                                                                                                               | `provider.openGenerativeUI`                       | `SandboxedStay`                    |
| A2UI                     | Declarative UI the agent composes         | on-with-caveat — The model draws only when the traveller asks for a comparison (the server catalog’s guidance), otherwise it answers in text. The preset sends `includeSchema: false`: the catalog the model reads is the Lambda’s, and a component outside it is refused. Basic-catalog components style themselves inline; only `--a2ui-primary-color` follows the chat theme. | `provider.a2ui`                                   | `HotelComparison`, `AddToTripPlan` |
| MCP Apps                 | MCP app surfaces                          | backend-blocked (lambda-backend)                                                                                                                                                                                                                                                                                                                                                 | `—`                                               | `Overview`                         |
| JSON Render              | Typed-spec dashboards                     | out-of-scope                                                                                                                                                                                                                                                                                                                                                                     | `provider.renderToolCalls`                        | `Overview`                         |
| Hashbrown                | Streaming structured UI                   | out-of-scope                                                                                                                                                                                                                                                                                                                                                                     | `provider.renderToolCalls`                        | `Overview`                         |

### Human in the loop

| Feature                  | Summary                       | Status                                                                                                                                                                                                                      | Seam                           | Stories                                          |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------ |
| Approval tool            | Agent pauses on a tool call   | on-with-caveat — FINDING-4; DeepSeek thinking off.                                                                                                                                                                          | `children (useHumanInTheLoop)` | `AwaitingAnswer`, `TalkedPastPrompt`             |
| Agent interrupt          | LangGraph interrupt() outcome | on-with-caveat — FINDING-5: CopilotChat's own input does not hold while an interrupt is open, so a message sent past the card is refused with the error line; a custom composer reading `useAwaitingInterrupt()` avoids it. | `children (useInterrupt)`      | `AwaitingConfirmation`, `TalkedPastConfirmation` |
| Headless interrupts      | Interrupt UI outside the chat | on                                                                                                                                                                                                                          | `children (useInterrupt)`      | `ConfirmationInSidePanel`                        |
| Governed action approval | Approval card with a verdict  | out-of-scope                                                                                                                                                                                                                | `provider.humanInTheLoop`      | `Overview`                                       |

### Context and state

| Feature              | Summary                        | Status         | Seam                              | Stories                                            |
| -------------------- | ------------------------------ | -------------- | --------------------------------- | -------------------------------------------------- |
| Readables            | App state the agent can read   | on             | `context`                         | `TravellerName`, `MultipleEntries`                 |
| Forwarded properties | Per-run metadata               | off-by-default | `provider.properties`             | `PropertiesOnTheWire`                              |
| Shared state read    | Render agent state anywhere    | on             | `children (useAgent)`             | `TripPlanBesideTheChat`                            |
| Shared state write   | App writes state               | on             | `children (useAgent)`             | `TravellerEditsThePlan`                            |
| Streaming state      | Live partial state             | on             | `children (useAgent)`             | `PlanFillsInWhileTheAgentWrites`                   |
| Activity messages    | Progress cards                 | off-by-default | `provider.renderActivityMessages` | `ProgressWhileTheAgentWorks`, `CustomProgressCopy` |
| Custom messages      | UI before or after any message | off-by-default | `provider.renderCustomMessages`   | `TimestampAfterEachAssistantMessage`               |
| Capabilities         | Agent self-description         | on             | `children (useCapabilities)`      | `CapabilitiesPanel`                                |
| Sub-agents           | Supervisor fan-out log         | not-applicable | `—`                               | —                                                  |

### Threads

| Feature                     | Summary                      | Status                                                                                                                                                                                       | Seam                                     | Stories                                 |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| Auto thread id              | Conversation scoping         | on                                                                                                                                                                                           | `—`                                      | `FreshIdPerMount`                       |
| Explicit threadId           | Restore a known conversation | on                                                                                                                                                                                           | `chat.threadId`                          | `RestoredConversation`, `UnknownThread` |
| Switch or new thread        | Thread navigation            | on                                                                                                                                                                                           | `children (useCopilotChatConfiguration)` | `ConversationWithNewThreadButton`       |
| Thread list                 | List conversations           | on-with-caveat — Read-only: `useThreads`' rename, archive and delete are CopilotKit Intelligence (422 here, `threadEndpoints.mutations: false`) — the client app deletes through client-api. | `children (useThreads)`                  | `KeptConversations`                     |
| Self-managed persistence    | Server-side history          | on                                                                                                                                                                                           | `—`                                      | `ReopenAfterRemount`                    |
| Rich Threads (Intelligence) | Cloud thread store           | out-of-scope                                                                                                                                                                                 | `—`                                      | `Overview`                              |

### Composer

| Feature         | Summary                       | Status                                                                                                                                                          | Seam                   | Stories                   |
| --------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------- |
| Attachments     | Files in the composer         | off-by-default — Lambda body ceiling 512 KB (413); the graph reads text only.                                                                                   | `chat.attachments`     | `Enabled`, `FileQueued`   |
| Tools menu      | Menu button next to the input | off-by-default                                                                                                                                                  | `chat.input.toolsMenu` | `MenuOpen`                |
| Auto-focus      | Focus the textarea on mount   | off-by-default                                                                                                                                                  | `chat.input.autoFocus` | `FocusedOnMount`          |
| Voice input     | Speech-to-text                | on-with-caveat — The Lambda offers it only when GEMINI_API_KEY is set — without the key `/info` says `audioFileTranscriptionEnabled: false` and no mic renders. | `—`                    | `Dictated`, `RateLimited` |
| Input slots     | Replace composer parts        | off-by-default                                                                                                                                                  | `chat.input`           | `CustomSendButton`        |
| Stop generation | Cancel a run                  | on-with-caveat — FINDING-3: the client never aborts the run fetch, so the chat stays running until the buffered response lands.                                 | `—`                    | `Running`                 |
| Custom submit   | Intercept sends               | out-of-scope                                                                                                                                                    | `—`                    | `Overview`                |

### Messages

| Feature                        | Summary                              | Status                                                                                                                                                                            | Seam                                                 | Stories                                   |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| Markdown (Streamdown)          | Headings, lists, tables, code, KaTeX | on — react-core 1.90.0 ships Streamdown with `rehype-harden` wide open (`*` prefixes, data images), so a prompt-injected image would be fetched on render; the package closes it. | `—`                                                  | `MarkdownReply`, `HardenedImagesAndLinks` |
| Custom markdown renderer       | Swap the renderer                    | off-by-default                                                                                                                                                                    | `chat.messageView.assistantMessage.markdownRenderer` | `PlainTextRenderer`                       |
| Copy message or code           | Clipboard actions                    | on                                                                                                                                                                                | `chat.messageView.assistantMessage.copyButton`       | `CopyButtons`, `CopyButtonsOff`           |
| Thumbs up and down             | Feedback capture                     | off-by-default                                                                                                                                                                    | `features.feedback`                                  | `ThumbsButtons`                           |
| Regenerate                     | Button + callback                    | off-by-default                                                                                                                                                                    | `chat.messageView.assistantMessage.onRegenerate`     | `RegenerateButton`                        |
| Read aloud                     | Button + callback                    | off-by-default                                                                                                                                                                    | `chat.messageView.assistantMessage.onReadAloud`      | `ReadAloudButton`                         |
| Edit user message and branches | Edit + branch navigation             | off-by-default — Branch navigation never renders: `CopilotChatMessageView` passes no `numberOfBranches`, so `onSwitchToBranch` is dead on this seam.                              | `chat.messageView.userMessage.*`                     | `EditButton`                              |
| Reasoning messages             | Collapsible thinking block           | on                                                                                                                                                                                | `chat.messageView.reasoningMessage`                  | `ThoughtBeforeTheReply`                   |
| Loading cursor                 | Custom thinking indicator            | on — The default cursor is on; a custom one is off-by-default.                                                                                                                    | `chat.messageView.cursor`                            | `Thinking`, `CustomCursor`                |
| Message slots                  | Per-message chrome                   | off-by-default                                                                                                                                                                    | `chat.messageView`                                   | `ExtraToolbarItem`, `ToolbarHidden`       |
| Empty reply                    | Chat usable after an empty turn      | on                                                                                                                                                                                | `—`                                                  | `EmptyReply`                              |
| Intelligence badge             | Cloud badge                          | out-of-scope                                                                                                                                                                      | `—`                                                  | `Overview`                                |

### Theming and styling

| Feature               | Summary                              | Status                                                                                                                                                                                                                                                                   | Seam               | Stories                                       |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------- |
| Design tokens         | Re-skin every v2 component           | off-by-default                                                                                                                                                                                                                                                           | `theme`            | `BrandTokens`, `PortalBoundary`, `HostScope`  |
| Dark mode             | Dark palette                         | off-by-default                                                                                                                                                                                                                                                           | `theme`            | `Dark`, `DarkPortalBoundary`, `DarkHostClass` |
| Class overrides       | Utility classes per part             | off-by-default                                                                                                                                                                                                                                                           | `chat.messageView` | `Default`, `ClassNameSlot`                    |
| Structural chrome     | The chat has height without Tailwind | on                                                                                                                                                                                                                                                                       | `—`                | `StructuralCss`                               |
| Tailwind utilities    | Cosmetic chrome                      | on-with-caveat — The host must scan the package: `apps/client/ui/src/styles/globals.css:12` `@source '../../../../../vendor/packages/ai-chat-fe/src'`; the package Storybook does the same in `.storybook/tailwind.css`; a non-Tailwind host loses only these cosmetics. | `—`                | `UtilitiesRender`                             |
| CopilotKit stylesheet | The chat's own look                  | on                                                                                                                                                                                                                                                                       | `—`                | `Overview`                                    |
| Host class hook       | Host layout control                  | on                                                                                                                                                                                                                                                                       | `className`        | `BoundedHeight`                               |

### Runtime and auth

| Feature              | Summary                     | Status         | Seam                   | Stories                                         |
| -------------------- | --------------------------- | -------------- | ---------------------- | ----------------------------------------------- |
| Runtime URL          | Where the client posts      | on             | `runtimeUrl`           | `Default`                                       |
| Agent id             | Which agent runs            | on             | `agentId`              | `AgentIdOnTheWire`, `ChildrenHookResolvesAgent` |
| Cookies              | Same-origin cookie auth     | on             | `provider.credentials` | `SameOriginCredentials`                         |
| Headers              | Bearer tokens and similar   | off-by-default | `provider.headers`     | `Default`, `HeaderReachesRuntime`               |
| Single-route runtime | Legacy single POST route    | not-applicable | `—`                    | —                                               |
| Render throttle      | Streaming re-render cadence | not-applicable | `—`                    | —                                               |
| Streaming replies    | Token streaming             | on             | `—`                    | `Overview`                                      |
| Runtime handshake    | Flags the client reads      | on             | `—`                    | `InfoOk`, `InfoUnauthorized`                    |

### Errors and observability

| Feature              | Summary                        | Status                                                                     | Seam                       | Stories                                                                                                       |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Error events         | The only error channel         | on                                                                         | `onError`                  | `RunError`, `CutShort`, `SessionExpired`, `TooLong`, `Throttled`, `Unavailable`, `Offline`, `OnErrorCallback` |
| Traveller error line | Visible failure text           | on                                                                         | `features.errorLine`       | `InChat`, `Unavailable`, `SessionExpired`, `CustomErrorLine`, `ReWorded`, `Off`                               |
| Failure taxonomy     | Status or code → copy          | on                                                                         | `features.errorLine`       | `Overview`                                                                                                    |
| Chat-scoped onError  | Per-surface handler            | out-of-scope                                                               | `—`                        | `Overview`                                                                                                    |
| Debug logging        | Console lifecycle logs         | off-by-default                                                             | `provider.debug`           | `Default`, `LifecycleLogged`                                                                                  |
| Inspector            | Dev panel                      | off-by-default                                                             | `provider.enableInspector` | `Default`, `Enabled`                                                                                          |
| Console re-emit      | Devtools and e2e signal        | on                                                                         | `—`                        | `HandshakeFailed`, `RunFailed`                                                                                |
| Run status           | Error line clears on run start | on                                                                         | `children (useAgent)`      | `Idle`, `Running`, `Failed`                                                                                   |
| Programmatic run     | Trigger a turn from outside    | on                                                                         | `children (useCopilotKit)` | `ButtonOutsideChatRuns`                                                                                       |
| Read the transcript  | Export client-side             | on                                                                         | `children (useAgent)`      | `TranscriptLength`                                                                                            |
| Reset on user switch | Clear a conversation           | on-with-caveat — The remount re-mints the thread id; nothing is persisted. | `—`                        | `KeyRemountClears`                                                                                            |

### Not exposed

| Feature           | Summary                           | Status                 | Seam | Stories    |
| ----------------- | --------------------------------- | ---------------------- | ---- | ---------- |
| Threads drawer    | Needs publicLicenseKey            | out-of-scope (license) | `—`  | `Overview` |
| Copilot Cloud     | Cloud; guardrails are backend     | out-of-scope           | `—`  | `Overview` |
| Intelligence      | Cloud license                     | out-of-scope           | `—`  | `Overview` |
| In-browser agents | Bypasses the runtime and its auth | out-of-scope           | `—`  | `Overview` |
| showDevConsole    | Superseded by enableInspector     | not-applicable         | `—`  | —          |
| OSS telemetry     | Runtime-side                      | not-applicable         | `—`  | —          |

<!-- catalogue:end -->

## Facts about CopilotKit 1.90.0 the tests pin

Each of these is asserted by a `__tests__` case against the runtime fake, so a CopilotKit upgrade
that changes it goes red here rather than in production. The paths name the feature's stories under
`src/features/ai-chat/__stories__/`; its assertions are in `__tests__/<area>.test.tsx`.

- `CopilotSidebar` / `CopilotPopup` mount **open** (`defaultOpen` defaults to `true`); pass
  `surface.defaultOpen: false` to start closed. `clickOutsideToClose` is off unless set
  (`__tests__/surfaces.test.tsx`).
- The 33 design tokens are declared on `[data-copilotkit]` itself; a value set on an ancestor is
  inert. `CopilotChat` wraps its root in a `display: contents` div, which is why `styles.css` uses a
  descendant selector and why `theme.scope: 'chat'` stops at the wrapper — portals (tooltips,
  dropdowns, the tools menu) mount at `<body>` with their own `[data-copilotkit]` root
  (`theming/theme.tokens#PortalBoundary`, `#HostScope`). Chromium keeps `oklch(…)` in computed
  styles, so the assertions compare oklch strings.
- `copilot-send-button` and `copilot-chat-input` are hard-coded (`cpk:bg-black`, …), not token
  readers; `copilot-suggestion` reads `--background` / `--foreground`, the tooltip `--primary`, the
  dropdown `--popover` (`theming/theme.tokens#BrandTokens`).
- `provider.frontendTools[].render` is registered only when the tool carries `parameters` (core:
  `if (args)`); a schema-less render is dropped silently. The `useFrontendTool` hook path renders
  without one (`tools/tools.frontend`, `tools/tools.followUp`).
- A tool call with no renderer renders **nothing** (dev-only `console.warn`); the built-in card
  (`copilot-tool-render*`) appears only once `useDefaultRenderTool('*')` registers the wildcard
  (`tools/tools.defaultView`).
- Regenerate, read-aloud and edit are **button + callback only**: `onRegenerate` never re-runs the
  turn (`runs` stays at 1), and branch navigation never renders because `CopilotChatMessageView`
  passes no `numberOfBranches` (`messages/messages.regenerate`, `messages/messages.userEdit`).
- `chat.threadId` makes core `POST /agent/:id/connect` at **mount** and the welcome screen is
  skipped; the Lambda replays the traveller's kept chat, or nothing for an unknown or foreign id
  (`threads/threads.explicit`). Until the first replayed message react-core draws a spinner
  (`copilot-connecting-indicator`, "Loading conversation") unless `chat.connectingIndicator` is
  `false`, which the preset sets. A new thread from `useCopilotChatConfiguration` works without any
  request (`threads/threads.switch`).
- Dynamic suggestions call `POST /agent/:id/suggest` whenever `/info.suggestions === true`; the
  Lambda 404s it. `reloadSuggestions()` on a static config clears and re-adds synchronously with no
  network (`suggestions/suggestions.dynamic`, `suggestions/suggestions.programmatic`).
- A custom `suggestionView.suggestion` must set `pointer-events: auto` — the container is
  `pointer-events: none` (`suggestions/suggestions.view#CustomPill`).
- The inspector (`<cpk-web-inspector>`) mounts only on `localhost` **and** when the bundle was built
  with `NODE_ENV=development` (`import.meta.env.MODE === 'development'`): it mounts under
  `storybook dev`, never under the vitest runner or a built Storybook, and the test follows the same
  gate (`errors/obs.inspector#Enabled`).
- Reasoning frames are `REASONING_*` (`REASONING_START` / `_MESSAGE_*` / `_END`); the older
  `THINKING_*` frames carry no `messageId` and never render a block (`__tests__/helpers/frames.ts`,
  `messages/messages.reasoning`).
- `keyof CopilotChatProps` is `string` (`CopilotChatViewProps` has an index signature), so
  `AiChatSurface` uses named picks. `@copilotkit/core` and `@ag-ui/core` are not resolvable from the
  package; react-core's v2 entry re-exports two of core's enums (`CopilotKitCoreErrorCode`,
  `CopilotKitCoreRuntimeConnectionStatus`) and none of its types: suggestion types come off
  `useConfigureSuggestions`' parameter, provider error codes off `CopilotKitProviderProps['onError']`
  (18 codes, `satisfies`-checked in `catalogue/services/feature-docs.ts`), and
  `CopilotChatViewProps.messages` is `any`. `CopilotChatDefaultLabels` (44 keys) lives in
  `@copilotkit/react-core/v2/headless`.
- The user-message toolbar is hover-only CSS (`cpk:invisible group-hover:visible`): tests assert
  presence and click directly (`messages/messages.copy`, `messages/messages.userEdit`).
- Uploads in a test need `userEvent.upload(…, { applyAccept: false })` — CopilotKit's `*/*` accept
  reads as "nothing" under user-event (`composer/composer.attachments`). The send is refused while
  an upload is in progress; the wire shape is `content` parts `{ type, source, metadata: { filename } }`.
- `CopilotChat.onSubmitMessage` is silently overridden by the internal handler; the run-status
  subscription (`useAgent({ updates: [OnRunStatusChanged] })`) is the only "the traveller sent
  something" signal, which is how the error line clears (`errors/control.runStatus`).
- `useCopilotChatConfiguration()` is `null` outside `CopilotChat`'s own provider; `CopilotChat`
  inherits `agentId` / `labels` / `threadId` from an outer `CopilotChatConfigurationProvider`, which is
  what `AIChat` relies on for `children` hooks (`surfaces/surface.headless`, `__tests__/surfaces.test.tsx`,
  `runtime/runtime.agentId#ChildrenHookResolvesAgent`).
- `useConfigureSuggestions` registers for `useCopilotChatConfiguration()?.agentId ?? 'default'` and
  ignores the provider's `agentId` (FINDING-1 below).
- CopilotKit stringifies non-string agent-context values on the wire (`context/context.agentContext#MultipleEntries`).

## States and how to see them

Tests: `src/features/ai-chat/__tests__/ai-chat-states.test.tsx` unless noted; rows 1, 5 and 6 are in
`src/features/ai-chat/__tests__/ai-chat-container.test.tsx`, rows 23–24 in `ai-chat-tools.test.tsx`. Story
paths are under `src/features/ai-chat/__stories__/`; `suggestions/suggestions.static.stories.tsx#Default`,
`#SuggestionClick` and `surfaces/copy.disclaimer.stories.tsx#WithDisclaimerOverride` still render the shipped
`AIChatContainer` with the test preset; every other story renders `<AIChat>` with `NOMADREAM_PRESET` (the
client's preset copied into `__tests__/helpers/preset.ts`) and the kit's `Ada` context entry. Lambda references are `vendor/packages/ai-chat-be/src/`.

| #   | Feature                                                                   | Story                                                                                                                                                      | `it`                                                                                                                                              | Lambda behaviour / source                                                               | Status                                                                     |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Provider boot: `GET /info`, `credentials: same-origin`                    | `suggestions/suggestions.static.stories.tsx#Default`, `runtime/runtime.credentials.stories.tsx#SameOriginCredentials`                                      | `'sends the same-origin request with credentials so the session cookie reaches the runtime'`                                                      | `/info` lists `travelAiAgent`; the access cookie must reach the runtime                 | verified                                                                   |
| 2   | Welcome text + placeholder, NomaDream disclaimer                          | `suggestions/suggestions.static.stories.tsx#Default`, `surfaces/copy.labels.stories.tsx#CustomPlaceholder`, `surfaces/copy.disclaimer.stories.tsx#Default` | `'renders the chat with the NomaDream welcome text'`, `'shows the placeholder and the NomaDream disclaimer'`                                      | none (FE copy)                                                                          | verified                                                                   |
| 2a  | `chat` overrides merged over the preset's `chat` (e.g. a disclaimer back) | `surfaces/copy.disclaimer.stories.tsx#WithDisclaimerOverride`                                                                                              | `'a consumer can bring the disclaimer back through chat overrides'`                                                                               | none (FE prop; `labels`/`input` merge key by key)                                       | verified                                                                   |
| 3   | Three suggestion pills before the first message                           | `suggestions/suggestions.static.stories.tsx#Default`                                                                                                       | `'renders the three suggestions before the first message'`, `'the shipped container renders its suggestion pills for the chat agent (FINDING-1)'` | none (`useConfigureSuggestions`, static list)                                           | verified — fixed during the audit (FINDING-1)                              |
| 4   | Suggestion click sends its message, pills disappear                       | `suggestions/suggestions.static.stories.tsx#AfterPillClick`                                                                                                | `'a clicked suggestion is sent as the user message'`                                                                                              | one run whose last user message is the pill text                                        | verified                                                                   |
| 5   | Send on Enter + user echo + buffered reply                                | `messages/messages.markdown.stories.tsx#MarkdownReply`                                                                                                     | `'sends the traveller name as agent context to travelAiAgent and renders the buffered reply'`                                                     | one buffered body: `RUN_STARTED … TEXT_MESSAGE_* … RUN_FINISHED`                        | verified                                                                   |
| 6   | Traveller name on the wire as `context`                                   | `messages/messages.markdown.stories.tsx#MarkdownReply` (kit `args.context`), `context/context.agentContext.stories.tsx#TravellerName`                      | same as row 5                                                                                                                                     | `context[]` entry on the run body (`useAgentContext`)                                   | verified                                                                   |
| 7   | Markdown / long reply (headings, list, code, scroll)                      | `messages/messages.markdown.stories.tsx#MarkdownReply`                                                                                                     | `'renders a long markdown reply'`                                                                                                                 | long `TEXT_MESSAGE_CONTENT`                                                             | verified                                                                   |
| 8   | Empty reply (no `TEXT_MESSAGE_CONTENT`)                                   | `messages/messages.empty.stories.tsx#EmptyReply`                                                                                                           | `'an empty reply leaves the chat usable'`                                                                                                         | `RUN_STARTED`, empty message, `RUN_FINISHED`; no assistant bubble renders               | verified                                                                   |
| 9   | In-flight: `copilot-loading-cursor`, send button = stop                   | `messages/messages.cursor.stories.tsx#Thinking` (`hang`)                                                                                                   | `'shows the loading cursor while the run is open'`                                                                                                | the buffered Lambda holds the response for the whole run (~29 s real)                   | verified                                                                   |
| 10  | Stop: `abortRun` + `POST agent/:id/stop/:threadId`                        | `composer/composer.stop.stories.tsx#Running` (reply delayed 3 s)                                                                                           | `'stop posts the stop route but never aborts the run (FINDING-3)'`                                                                                | stop route answers `200 {}`; the run response still lands (FINDING-3)                   | verified — path only (the fetch is never aborted)                          |
| 11  | `RUN_ERROR` frame                                                         | `errors/errors.onError.stories.tsx#RunError`                                                                                                               | `"a RUN_ERROR frame shows the Lambda's message under the chat"`                                                                                   | `copilotkit/inProcessAgent.ts:12` (`RUN_ERROR_MESSAGE`)                                 | verified — error line rendered by this package (FINDING-2)                 |
| 12  | Partial text + synthetic `RUN_ERROR` (watchdog)                           | `errors/errors.onError.stories.tsx#CutShort`                                                                                                               | `'partial text survives a trailing RUN_ERROR and the watchdog text marks it as cut short'`                                                        | `lambda/copilotkit.ts:310` drain watchdog (`RUN_TIMEOUT_MESSAGE`), one body             | verified                                                                   |
| 13  | Second turn after an error works                                          | `errors/errors.onError.stories.tsx#RunError`, `errors/control.runStatus.stories.tsx#Failed` (`run: [error, reply]`)                                        | `'the chat recovers after a RUN_ERROR and the error line clears with the next run'`                                                               | run 1 `RUN_ERROR`, run 2 reply                                                          | verified                                                                   |
| 14  | HTTP 401 on run                                                           | `errors/errors.onError.stories.tsx#SessionExpired`                                                                                                         | `'a 401 run surfaces the unauthorized body'`                                                                                                      | `lambda/copilotkit.ts` session gate, `UNAUTHORIZED_BODY`                                | verified                                                                   |
| 15  | HTTP 401 on `/info`                                                       | `runtime/runtime.info.stories.tsx#InfoUnauthorized`, `errors/obs.consoleError.stories.tsx#HandshakeFailed`                                                 | `'a 401 /info is swallowed by the auto transport — welcome renders with the offline line, Enter is dead'`                                         | same gate; the auto transport then falls back to `POST {method:'info'}` → 404           | verified — the textarea is still dead, but the line says so                |
| 16  | HTTP 404 (route not allow-listed)                                         | `errors/errors.onError.stories.tsx#Unavailable`                                                                                                            | `'a 404 run surfaces the not-found body'`                                                                                                         | `lambda/copilotkit.ts:326`, `NOT_FOUND_BODY`                                            | verified                                                                   |
| 17  | HTTP 413 (> 512 KB run body)                                              | `errors/errors.onError.stories.tsx#TooLong`                                                                                                                | `'a 413 run surfaces the payload-too-large body'`                                                                                                 | `lambda/copilotkit.ts:345`, `PAYLOAD_TOO_LARGE_BODY`                                    | verified                                                                   |
| 18  | HTTP 429 (per-traveller throttle)                                         | `errors/errors.onError.stories.tsx#Throttled`                                                                                                              | `'a 429 run surfaces the throttle body'`                                                                                                          | `lambda/copilotkit.ts:351`, `TOO_MANY_REQUESTS_BODY`                                    | verified                                                                   |
| 19  | HTTP 5xx                                                                  | `errors/errors.onError.stories.tsx#Unavailable`, `chat-failure-component.stories.tsx#Http500`                                                              | `'a 500 run surfaces a server error'`                                                                                                             | `GENERIC_ERROR_BODY` (`INTERNAL_ERROR`)                                                 | verified                                                                   |
| 20  | Network failure (fetch rejects)                                           | `errors/errors.onError.stories.tsx#Unavailable`                                                                                                            | `'a network failure surfaces the unavailable line and re-enables input'`                                                                          | none — the browser rejects with `TypeError: Failed to fetch`                            | verified                                                                   |
| 21  | `clientOnly` fallback "Loading the assistant…"                            | client Storybook (port 3002) `features/chat/ChatContainer` → `Loading`                                                                                     | none — visual only                                                                                                                                | none; the client route defers the package to the browser                                | verified                                                                   |
| 22  | Remount on user switch (`key={user.id}`)                                  | `errors/control.remount.stories.tsx#KeyRemountClears`                                                                                                      | none                                                                                                                                              | `routes/…/chat.tsx`; the remount re-mints the thread id, nothing is persisted           | mechanism verified against the fake; the two-account e2e is still deferred |
| 23  | `TOOL_CALL_*` frames rendered for a `useFrontendTool`                     | `tools/tools.frontend.stories.tsx#HotelCard`                                                                                                               | `'renders TOOL_CALL frames for a registered frontend tool'`                                                                                       | `copilotkit/inProcessAgent.ts:152-165` emits the frames; the product registers no tool  | verified — path only, no product tool                                      |
| 24  | Human-in-the-loop round trip (`useHumanInTheLoop`)                        | `hitl/hitl.tool.stories.tsx#AwaitingAnswer`                                                                                                                | `'a human response is sent as a tool message on the next run'`                                                                                    | run 2 carries `{ role: 'tool', toolCallId, content }`; nothing in the product does this | verified — path only, no product tool                                      |

## What the traveller sees on failure (observed)

Read off a vitest browser run of `<AIChatContainer preset={NOMADREAM_PRESET} userName="Ada" />` against `src/features/ai-chat/__tests__/helpers`
(@copilotkit/react-core 1.90.0 v2 entry, @copilotkit/core 1.90.0, @ag-ui/client 1.0.5).

**CopilotKit v2 has NO error UI of its own.** `copilot-error-banner` is the v1 `ToastProvider`
toast; the v2 `CopilotKitProvider` never mounts it. Without an `onError` prop the provider only
`console.error`s. This package therefore supplies the provider `onError`
(`src/features/ai-chat/containers/ai-chat-root-container.tsx`) and renders one red line under the surface (`ChatFailureComponent`,
or the consumer's `features.errorLine` component) —
`<p role="alert" data-testid="ai-chat-error" data-kind="…">` — with the text chosen by
`src/features/ai-chat/services/chat-failure.ts` (`describeChatFailure(event, text?)`; `features.errorLine.text` re-words a kind). The same handler re-emits the failure as
`console.error('[ai-chat] <code>:', error)`; CopilotKit's own `[CopilotKit] Error (<code>)` line
is gone once a handler is supplied. The line clears when the next run starts (`useAgent`
`isRunning`), so a retry that succeeds shows the reply with nothing under it; a retry that fails
again shows the line again. The consumer's `onError(failure, event)` fires after the line is set.

| Scenario                     | Red line under the chat (`data-kind`)                                               | What the chat shows                                                                                                                                  | Input usable after?                                                                    | `console.error` (verbatim first line)                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `runError`                   | `The assistant could not answer that. Please try again.` (`run-error`)              | user bubble stays, no assistant bubble, cursor gone, the line under the input                                                                        | yes — textarea enabled and cleared; Enter sends run 2 (which fails and re-shows it)    | `[ai-chat] agent_run_error_event: Error: The assistant could not answer that. Please try again.`                                 |
| `partialThenRunError`        | `The assistant took too long to respond.` (`run-error`)                             | assistant bubble with the partial text stays; the watchdog's line under it marks the answer as cut short                                             | yes                                                                                    | `[ai-chat] agent_run_error_event: Error: The assistant took too long to respond.`                                                |
| `runErrorThenRetry`          | run 1: as `runError`; run 2: **none**                                               | the line appears after run 1 and disappears the moment run 2 starts; the reply renders with nothing under it                                         | yes                                                                                    | one `agent_run_error_event` line                                                                                                 |
| `http401` (run)              | `Your session has expired — sign in again to continue.` (`session-expired`)         | user bubble, no assistant bubble, the line                                                                                                           | yes (run 2 sent)                                                                       | `[ai-chat] agent_run_failed_event: Error: HTTP 401: {"error":"Sign in to use the assistant.","type":"UNAUTHENTICATED"}`          |
| `infoUnauthorized` (`/info`) | `The assistant is unavailable right now. Reload the page to try again.` (`offline`) | the welcome screen renders normally (heading, enabled textarea) with the line; Enter afterwards does nothing — 0 runs, 0 bubbles, and the line stays | textarea enabled but dead                                                              | `[ai-chat] runtime_info_fetch_failed: Error: Runtime info request failed with status 404`                                        |
| `http404`                    | `The assistant is unavailable right now. Please try again.` (`unavailable`)         | user bubble, no assistant bubble, the line                                                                                                           | yes (run 2 sent)                                                                       | `[ai-chat] agent_run_failed_event: Error: HTTP 404: {"error":"Not found","type":"NOT_FOUND"}`                                    |
| `http413`                    | `This conversation got too long — start a new one.` (`too-long`)                    | user bubble, no assistant bubble, the line                                                                                                           | yes (run 2 sent)                                                                       | `[ai-chat] agent_run_failed_event: Error: HTTP 413: {"error":"The conversation is too long.","type":"PAYLOAD_TOO_LARGE"}`        |
| `http429`                    | `Too many requests — give it a minute and try again.` (`throttled`)                 | user bubble, no assistant bubble, the line                                                                                                           | yes (run 2 sent)                                                                       | `[ai-chat] agent_run_failed_event: Error: HTTP 429: {"error":"Slow down a little.","type":"TOO_MANY_REQUESTS"}`                  |
| `http500`                    | `The assistant is unavailable right now. Please try again.` (`unavailable`)         | user bubble, no assistant bubble, the line                                                                                                           | yes (run 2 sent)                                                                       | `[ai-chat] agent_run_failed_event: Error: HTTP 500: {"error":"The assistant is unavailable right now.","type":"INTERNAL_ERROR"}` |
| `networkError`               | `The assistant is unavailable right now. Please try again.` (`unavailable`)         | user bubble, no assistant bubble, the line                                                                                                           | yes (run 2 sent)                                                                       | `[ai-chat] agent_run_failed_event: TypeError: Failed to fetch`                                                                   |
| `emptyReply`                 | none                                                                                | user bubble only; no assistant bubble; cursor gone                                                                                                   | yes (run 2 sent)                                                                       | none                                                                                                                             |
| `thinking` (`hang`)          | none                                                                                | `copilot-loading-cursor` under the user bubble; `copilot-send-button` shows the `lucide-square` icon (= stop)                                        | textarea NOT disabled; Enter with text clears it and sends nothing; Enter empty = stop | none                                                                                                                             |
| `stopGeneration`             | none                                                                                | after the click: stop POST recorded, cursor and square icon STILL shown; the reply then lands and the cursor clears                                  | enabled, but a re-send creates no run while the run is open                            | none                                                                                                                             |
| HITL wait state              | none                                                                                | the tool's `render` inside the assistant turn with `status=executing`; no cursor; send button shows the arrow                                        | yes — Enter starts a NEW run while the prompt is still open                            | none                                                                                                                             |

HTTP run failures log three lines each (`[ai-chat] agent_run_failed_event`, ag-ui's own
`Agent execution failed: …`, `[ai-chat] agent_run_failed`); the table shows the first. The
provider `onError` fires for both `agent_run_failed_event` and `agent_run_failed`, so
`describeChatFailure` runs twice per HTTP failure and lands on the same line both times.

Findings behind the table:

- **FINDING-2 — no error UI in v2: FIXED in this package.** The traveller now reads one line under
  the input per failure (table above); a 413 says the thread is too long, a dead `/info` says
  to reload. Seam: provider `onError` → `describeChatFailure` → `<p role="alert">`; v2 itself still
  renders nothing, and the dead textarea after a failed `/info` is unchanged (Enter still swallows
  the text — only the line tells the traveller why).
- **FINDING-3 — stop never aborts the run fetch.** `stopAgent` aborts core's own controller and
  `ProxiedCopilotRuntimeAgent.abortRun` (@copilotkit/core 1.90.0) POSTs `/stop/:threadId`, but it
  overrides `HttpAgent.abortRun` without calling it, so the run request's `AbortController` never
  fires. With the buffered Lambda, stop is a no-op for the traveller until the response lands
  (≤ 29 s), and the stop POST reaches a different invocation that holds no such run.
  `scenarios.stopGeneration` is therefore a 3 s delayed reply (not `hang`) so the story terminates; a
  CopilotKit upgrade that starts aborting client-side flips the "cursor still visible" assertion —
  intended.
- **FINDING-4 — the HITL wait state is not a running state.** After run 1's `RUN_FINISHED` with the
  tool call open: no cursor, arrow icon, textarea enabled. Since react-core 1.7x `CopilotChat` queues an
  Enter until the active run settles, so the text leaves the box and is sent only after the prompt is
  answered — with nothing on screen saying so (`ai-chat-tools.test.tsx`). A run started any other way
  (`copilotkit.runAgent`, a pill) still starts at once and orphans the call
  (`hitl/hitl.tool.stories.tsx#TalkedPastPrompt`). Answering sends the next run with the assistant
  `toolCalls` entry followed by `{ role: 'tool', toolCallId: 'call-1', content: 'yes' }`.
- **FINDING-5 — an open interrupt refuses every other run, and nothing in CopilotChat says so.** After
  a run ends on `RUN_FINISHED.outcome.interrupt`, `@ag-ui/client` keeps `agent.pendingInterrupts` and
  `onInitialize` throws `Thread has N pending interrupt(s) not addressed by resume` for any run whose
  `resume` does not answer them (`@ag-ui/client` 1.0.5 `onInitialize`) — before the
  request, before RUN_STARTED, so no subscriber's `onRunFailed` fires. react-core 1.90.0 does not
  cancel or dismiss the interrupt (`useInterrupt` drops its prompt on RUN_STARTED and on a failed run, and shows
  it again when it mounts while `agent.pendingInterrupts` still lists it), and
  `CopilotChat`'s `onSubmitInput` adds the user message first and catches the error; core turns it
  into `AGENT_RUN_FAILED`. So the message sits unanswered under the error line
  and the prompt stays answerable (`hitl/hitl.interrupt.stories.tsx#TalkedPastConfirmation`).
  `useAwaitingInterrupt()` is the flag a composer holds on. `AIChat` itself closes the paths that
  would leave the list set with no prompt to answer (`InterruptReconciler` in
  `containers/ai-chat-root-container.tsx`): a resume run that errors or is stopped (react-core has
  dropped its prompt, the list has not been cleared — every later message would be refused), an
  interrupt past `expiresAt` (react-core will not resume it), and suggestion pills, withheld while an
  interrupt is open because a click starts the same refused run.
- **`infoUnauthorized` quirk.** The `auto` transport swallows the 401 on `GET /info` and falls back to
  `POST <runtimeUrl> {"method":"info"}`, which the Lambda allow-list (and the fake) answers 404 —
  hence the console says 404, not 401. The welcome screen renders, but Enter is dead.

## Fixed during the audit

- **FINDING-1 — suggestion pills never rendered since the port.** `useConfigureSuggestions`
  registers for `useCopilotChatConfiguration()?.agentId ?? 'default'`, and the hook ran outside
  `<CopilotChat agentId="travelAiAgent">`, so the configuration landed on agent `default`. Fixed with
  `consumerAgentId: agentId` — today in `services/config.ts` (`resolveSuggestions`), kept even though
  `AIChat` now also wraps everything in a `CopilotChatConfigurationProvider`, so the pills stay bound
  when a consumer renders the registrar outside the chat's configuration. Regression test:
  `'the shipped container renders its suggestion pills for the chat agent (FINDING-1)'` (through the
  shipped container, not a hand-built tree); `'a clicked suggestion is sent as the user message'`
  asserts three `copilot-suggestion` → zero after a click.

## Caveats and declared gaps

- The fake patches `window.fetch`. A transport change in `@ag-ui/client` (URL shape, method, body
  or the `/info` fallback) invalidates it silently; `src/features/ai-chat/__tests__/fake-runtime.test.ts` and the
  `Default` story's `/info` assertion are the tripwire.
- Not covered: CopilotKit rendered inside the client's `globals.css` theme (the package Storybook
  loads `@copilotkit/react-core/v2/styles.css`, `src/styles.css` and an unthemed Tailwind scan of
  `src/`); the deployed two-account remount (row 22); real latency and the real ~28 s drain
  watchdog; real LLM output.
- The package itself registers no production frontend tool or HITL tool; the `ToolCall` /
  `HumanInTheLoopDemo` stories register story-local demo tools only
  (`__tests__/helpers/demo-tools.tsx`). The client (`apps/client/ui`,
  `features/chat/containers/stay-preferences-tool.tsx`) registers the `ask_stay_preferences` HITL
  tool through `useHumanInTheLoop` (from `@wl/ai-chat-fe/copilotkit`), mounted through the `children` seam.
- DeepSeek thinking must stay OFF while tools are bound
  (`packages/ai-travel-agent/src/graph/models.ts`): in thinking mode with `tools` DeepSeek
  expects prior turns' `reasoning_content` back, which the frontend never sees. Any product HITL
  ticket inherits this constraint.
- `stories.test.tsx` runs 693 tests with 120 skipped at HEAD: the skips are `it.runIf` rows in
  `features.test.ts` (`deniedRoute` only for route /
  license / transport blocks), not disabled stories.
- The states table's hand-mirrored `__tests__` cases duplicate what `stories.test.tsx` now runs;
  deleting them after a recorded green run is a listed follow-up.

## Checklist for a manual pass

`pnpm --filter @wl/ai-chat-fe storybook` → http://localhost:3003. Sidebar paths are
`ai-chat/<Area>/<Feature>`; PASS / FAIL per story:

- **Catalogue** — every row of the README block, one card per feature, status badge and story links.
  FAIL = a row without a stories link that the block lists with stories.
- **Suggestions / Static pills → `Default`** — welcome text, three pills, placeholder, styled textarea,
  and NO disclaimer under the input (neither ours nor CopilotKit's "AI can make mistakes…"). FAIL =
  no pills, a raw unstyled textarea, or any disclaimer line.
- **Surfaces and copy / Disclaimer → `WithDisclaimerOverride`** — "Check the numbers." under the
  input, welcome text and placeholder unchanged. FAIL = no line, or CopilotKit's default
  welcome/placeholder.
- **Suggestions / Static pills → `SuggestionClick`** — the pill's message is the user bubble, pills
  gone, reply follows. FAIL = pills remain or no user bubble.
- **Messages / Markdown (Streamdown) → `MarkdownReply`; Messages / Empty reply → `EmptyReply`** —
  markdown rendered, scroll-to-bottom appears; empty reply = user bubble only, no assistant bubble,
  input usable. FAIL = raw markdown or a disabled input.
- **Messages / Loading cursor → `Thinking`** — `copilot-loading-cursor` visible, send button shows
  the square (stop) icon, textarea enabled. FAIL = cursor absent.
- **Composer / Stop generation → `StopGeneration`** — after the click the Interactions panel shows
  one entry in `stops` and the cursor is still visible; ~3 s later the reply lands and the cursor
  clears. FAIL = `stops` empty, or the cursor never clears.
- **Errors and observability / Error events → `RunError`, `Http401`, `Http404`, `Http413`,
  `Http429`, `Http500`, `NetworkError`** — the user bubble, no assistant bubble, and one red line
  under the input with the text from the table above (`RunError` = the Lambda's sentence, 401 =
  session expired, 413 = too long, 429 = too many requests, the rest = unavailable); the textarea
  accepts text and a retry sends (and, since the fake fails again, re-shows the same line). FAIL =
  no red line, a different text, an assistant bubble for an error, the textarea disabled, or the
  cursor still on after 2 s.
- **Error events → `PartialThenRunError`** — the partial answer stays in the assistant bubble AND the
  red line reads "The assistant took too long to respond." FAIL = the partial text missing, or no
  line.
- **Error events → `RunErrorThenRetry`** — the red line after the first send; after "once more" the
  line is gone and the reply shows with nothing under it. FAIL = the line still visible next to the
  reply.
- **Runtime and auth / Runtime handshake → `InfoUnauthorized`** — the welcome screen renders with
  the red line "The assistant is unavailable right now. Reload the page to try again."; Enter sends
  nothing (Interactions `runs` stays empty) and the line stays. FAIL = no line, or a run leaves.
- **Tools and generative UI / Frontend tool → `ToolCall`** — the demo card inside the assistant
  turn. FAIL = raw tool JSON or nothing.
- **Human in the loop / Approval tool → `HumanInTheLoopDemo`** — the prompt with buttons inside the
  assistant turn, no cursor, arrow send icon (the wait state is not a running state); click "Yes" →
  reply, and the Interactions panel shows `runs[1]` carrying the tool message. FAIL = no prompt, or
  no second run after the click.
- **Theming and styling / Design tokens → `BrandTokens`, `PortalBoundary`, `HostScope`** — cream
  pills with dark text; the `+` tools menu stays white under `PortalBoundary` and turns blue under
  `HostScope`. FAIL = white pills, or the menu themed under `PortalBoundary`.
- **Client Storybook 3002 → `features/chat/ChatContainer` → `Loading`** — page chrome plus "Loading
  the assistant…" persisting. FAIL = the fallback replaced.
