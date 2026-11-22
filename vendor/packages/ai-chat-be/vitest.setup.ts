import process from 'node:process'

// A developer shell often carries a REAL `DATABASE_URL` (`ik env-load`). A test that reaches the
// database without installing PGlite (`src/__tests__/helpers/testDb.ts`) must then fail on the
// missing URL, never write quota rows or chats to that database.
// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
process.env['DATABASE_URL'] = ''

// The same shell turns LangSmith tracing on, which would send test runs and feedback to LangSmith
// and break the tracing-off cases. These are the four switches `@langchain/core`'s
// `isTracingEnabled` reads; a test that needs tracing stubs it on itself.
for (const name of ['LANGSMITH_TRACING_V2', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_TRACING']) {
  delete process.env[name]
}
