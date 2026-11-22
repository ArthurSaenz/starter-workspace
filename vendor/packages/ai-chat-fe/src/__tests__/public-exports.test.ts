import { describe, expect, it } from 'vitest'

import * as copilotkit from '../copilotkit/index.js'
import * as root from '../index.js'
import * as markdown from '../markdown/index.js'
import * as preset from '../preset/index.js'

// The package's public surface (`package.json` exports): a name added or dropped here is a change for
// every consumer. `./copilotkit` is the one door to raw CopilotKit hooks (readme, exception E1), so none of
// them may reach the root, and no product value (a preset) may come back to any entry.
const names = (entry: object): string[] => {
  return Object.keys(entry).sort()
}

describe('public exports', () => {
  it('the root entry exports the chat and its own helpers, no raw CopilotKit hook', () => {
    expect(names(root)).toEqual([
      'AGENT_PROGRESS_ACTIVITY_TYPE',
      'AIChat',
      'AIChatContainer',
      'AI_CHAT_RUNTIME_URL',
      'AI_CHAT_TOKENS',
      'AgentProgressLine',
      'ChatFailureComponent',
      'SafeMarkdownRenderer',
      'ToolCallLine',
      'a2uiProps',
      'agentProgressRenderers',
      'defineAiChat',
      'describeChatFailure',
      'extendBasicA2uiCatalog',
      'resolveAiChat',
      'themeCss',
      'toolCallRenderers',
      'useAwaitingInterrupt',
      'useAwaitingToolCall',
    ])
  })

  it('./copilotkit exports exactly the seven CopilotKit hooks and types, unwrapped', () => {
    expect(names(copilotkit)).toEqual([
      'UseAgentUpdate',
      'useAgent',
      'useCapabilities',
      'useCopilotKit',
      'useFrontendTool',
      'useHumanInTheLoop',
      'useInterrupt',
    ])
  })

  it('./preset carries the runtime URL only, and ./markdown its hardening', () => {
    expect(names(preset)).toEqual(['AI_CHAT_RUNTIME_URL'])
    expect(names(markdown)).toEqual([
      'CHAIN_DOMAINS',
      'NO_RAW_HTML',
      'SAFE_COMPONENTS',
      'SafeMarkdown',
      'TRUSTED_LINK_DOMAINS',
      'TrustedHostsContext',
      'isAllowedHref',
      'isTrustedHost',
      'toSafeLink',
    ])
  })
})
