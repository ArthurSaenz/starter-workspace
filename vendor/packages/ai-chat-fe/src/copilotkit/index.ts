// `@wl/ai-chat-fe/copilotkit`, exception E1 of the chat dependency rule (readme "Dependencies"): CopilotKit's
// own hooks, unwrapped, for code mounted inside `AIChat`'s provider (through `children` or a slot). A door
// of its own so the root entry stays the package's API, and every raw CopilotKit import in an app is one
// grep away when react-core is bumped.
export {
  useAgent,
  UseAgentUpdate,
  useCapabilities,
  useCopilotKit,
  useFrontendTool,
  useHumanInTheLoop,
  useInterrupt,
} from '@copilotkit/react-core/v2'
