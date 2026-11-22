// The Lambda surface. No agent lives here: a host passes its own through `createCopilotkitHandlers`'s
// lazy `loadAgent`, so importing this module constructs no model — see apps/ai/ARCHITECTURE.md
// "Why InProcessAgent exists". What an agent package builds on is the `./kit` subpath.
export {
  buildRequest,
  buildRunErrorFrame,
  createCopilotkitHandlers,
  decodeChunk,
  flushTraces,
  HEARTBEAT_FRAME,
  isAllowedRoute,
  truncateToLastCompleteFrame,
} from './lambda/copilotkit.js'
export type {
  ChatAgentDefinition,
  ChatAppIdentity,
  CopilotkitHandlerOptions,
  CopilotkitHandlers,
  OpenResponseStream,
  ProxyEventLike,
  StreamMetadata,
} from './lambda/copilotkit.js'
export { buildCorsHeaders, extractRequestOrigin, resolveCorsOrigin } from './lambda/cors.js'
export { extractAccessToken, verifyCustomerSession } from './lambda/customerSession.js'
export type { CustomerSession, CustomerSessionIdentity } from './lambda/customerSession.js'
export { consoleJsonLogger, THREAD_RUN_STALE_SEC } from './ports.js'
export type {
  ChatHistoryStore,
  ChatLogger,
  ChatLoggerFactory,
  ChatRating,
  ChatRatingWrite,
  ChatStorage,
  KeptChat,
  KeptChatListing,
  KeptChatWrite,
  LogFields,
  RunFailure,
  RunFailureSink,
  RunFailureToolCall,
  RunLeaseStore,
  ThreadRunBeat,
  ThreadRunKey,
  UsageDay,
  UsageModelTotal,
  UsageStore,
} from './ports.js'
