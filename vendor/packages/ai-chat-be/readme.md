# @wl/ai-chat-be

The AI chat engine: CopilotKit v2 runtime + the in-process AG-UI ↔ LangGraph adapter + kept chats and
voice transcription, exposed as an API Gateway Lambda pair by `createCopilotkitHandlers`. It names no agent:
a host passes one through the lazy `loadAgent`, and an agent
package builds on the `./kit` subpath. Design notes and invariants live in the host repo's architecture doc.

Everything product-side is the host's, through `createCopilotkitHandlers`'s options and `src/ports.ts`:

- `storage: ChatStorage` — `history` (kept chats and thumbs), `usage` (daily quota and budgets),
  `runLeases` (one live run per thread, one summary turn per background run), `runFailures`, and
  `dropConnections`. The engine keeps no store and opens no connection.
- the checkpointer: the agent compiles its graph with a LangGraph `BaseCheckpointSaver` its host hands it.
- `app: { name, organizationId }` and `session: { issuer, audience }` — the product's name in the engine's
  own lines, and the session cookie's JWT pair.
- `createLogger`, a `ChatLoggerFactory` called with each module's service name; without one the engine logs
  through `consoleJsonLogger` (tests, local runs).

The host owns the adapters behind those ports. The package has no product dependency;
`@wl/auth-be` (vendored, product-free) verifies the session.
