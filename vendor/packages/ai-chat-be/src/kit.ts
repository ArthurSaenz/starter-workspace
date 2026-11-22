// Served as `@wl/ai-chat-be/kit`: what an agent package builds on. Like `./tools` before it, nothing
// here constructs a model or opens a connection at load, so a host can import it eagerly; the agent
// graph itself stays behind the host's lazy `loadAgent`. The engine keeps no store: what it reads and
// writes goes through the ports a host passes (`src/ports.ts`).
export {
  A2UI_BASIC_CATALOG_ID,
  A2UI_BASIC_CATALOG_ID_V1_0,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  A2UI_SURFACE_ACTIVITY,
  A2UI_TOOL_GUIDE_CONTEXT_DESCRIPTION,
  A2UI_TOOL_GUIDE_CONTEXT_VALUE,
  A2UI_TOOL_GUIDE_CONTEXT_VALUE_V1_0,
} from './copilotkit/a2ui.js'
export type { A2uiCatalogSchema, A2uiRuntimeOptions } from './copilotkit/a2ui.js'
export type { HistorySummarizer, HistorySummaryRequest } from './copilotkit/historySummary.js'
export type {
  CheckpointConfig,
  CheckpointStore,
  InProcessAgentConfig,
  InterruptResponseSchema,
  RunProgressConfig,
  SharedStateConfig,
  StreamableGraph,
} from './copilotkit/inProcessAgent.js'
export {
  CLEARED_TOOL_RESULT,
  formatAgentContext,
  splitAgentContext,
  toBindableTools,
  UNANSWERED_TOOL_CALL_RESULT,
} from './copilotkit/messageConversion.js'
export { programSummaryMarker } from './copilotkit/programSummaryMarker.js'
export type { ChatAgentDefinition } from './lambda/copilotkit.js'
export { LANGSMITH_FEEDBACK_KEY } from './lambda/feedback.js'
// The weight tables too, so a host can hold a SQL copy of the price table (a cost view) to them.
export {
  CACHE_READ_WEIGHTS,
  CACHE_WRITE_1H_WEIGHT,
  CACHE_WRITE_5M_WEIGHT,
  cacheReadWeight,
  DEFAULT_CACHE_READ_WEIGHT,
  MODEL_PRICE_WEIGHTS,
  modelPriceWeight,
  OPUS_INPUT_USD_PER_MTOK,
  OUTPUT_TOKEN_WEIGHT,
} from './lambda/pricing.js'
export { admitDailyBudget } from './lambda/usage.js'
export type { DailyAdmission } from './lambda/usage.js'
export { assistantReasoningOf, fetchWithReasoningReplay } from './langgraph/deepseekReasoning.js'
export { readLlmProvider, readModelId } from './langgraph/modelIdentity.js'
export type { LlmProvider } from './langgraph/modelIdentity.js'
export { isProviderBillingError, PROVIDER_CREDIT_EXHAUSTED_METRIC } from './langgraph/providerBilling.js'
export { maskTraceContent, scrubTraceValues } from './langgraph/traceMasking.js'
export type { LangChainCoreCopy, TraceMaskingMode } from './langgraph/traceMasking.js'
export type { UsageDay, UsageModelTotal, UsageStore } from './ports.js'
export { trackBackgroundWrite } from './tools/backgroundWrites.js'
export { capPayload, MAX_TOOL_RESULT_CHARS } from './tools/payload.js'
export { redactSecrets, toSafeErrorMessage } from './tools/redact.js'
export { defineServerTool } from './tools/types.js'
export type { McpToolResult, ServerToolDefinition, ServerToolSpec, ToolCallContext } from './tools/types.js'
// The AG-UI types an agent's own signatures name: the agent speaks AG-UI through the engine, so it declares
// no AG-UI package at runtime (devops/scripts/lib/check-chat-deps.ts).
export type { AgentCapabilities, Context, Tool } from '@ag-ui/client'
