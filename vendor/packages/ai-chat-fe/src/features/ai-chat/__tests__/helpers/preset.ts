import { AI_CHAT_RUNTIME_URL } from '../../../../lib/runtime-url.js'
import type { AiChatProps } from '../../index.js'

// The client's preset as it stood when it left the package (apps/client/ui/src/features/chat/services/
// chat-preset.ts): the tests and stories render the chat a real consumer configures, welcome text included.

const T = {
  welcome:
    'Hi, I’m the NomaDream assistant. Ask me about a long stay, a loyalty programme, or what a trip really costs.',
  placeholder: 'Ask anything…',
  suggestionLongStayTitle: 'Plan a long stay',
  suggestionLongStayMessage: 'I am planning a 3-week stay in Lisbon. How should I think about the total cost?',
  suggestionLoyaltyTitle: 'Compare programmes',
  suggestionLoyaltyMessage: 'Which hotel loyalty programme gives the most value for long stays?',
  suggestionStatusTitle: 'Elite status',
  suggestionStatusMessage: 'What does elite status actually get me on a two-week booking?',
}

// CopilotKit hard-codes `initial: 'smooth', resize: 'smooth'` on its `StickToBottom`, so switching
// to a kept chat animates down the whole history. Its props spread after those defaults, but its
// `ScrollView` type omits them — hence the cast.
const INSTANT_SCROLL = { initial: 'instant', resize: 'instant' } as Record<string, unknown>

const STREAM_THROTTLE_MS = 50

export const NOMADREAM_PRESET = {
  runtimeUrl: AI_CHAT_RUNTIME_URL,
  // The agent id registered by the ai-api Lambda (`GRAPH_ID` in @pkg/ai-travel-agent).
  agentId: 'travelAiAgent',
  // A2UI turns on from `/info`; the catalog the model reads is the Lambda's own (`A2UI_CATALOG_SCHEMA`
  // in @pkg/ai-travel-agent), so the browser's 50 kB basic-catalog schema and guides stay off the wire.
  // Every `useAgent` without its own filter (CopilotChat's message list among them) re-renders per
  // streamed token otherwise; 50 ms still reads as live typing.
  provider: {
    credentials: 'same-origin',
    enableInspector: false,
    a2ui: { includeSchema: false },
    defaultThrottleMs: STREAM_THROTTLE_MS,
  },
  chat: {
    labels: {
      welcomeMessageText: T.welcome,
      chatInputPlaceholder: T.placeholder,
    },
    scrollView: INSTANT_SCROLL,
    // react-core 1.88 would draw its own "Loading conversation" spinner while a kept chat connects;
    // the panel stays empty until the history lands, as it did before that release.
    connectingIndicator: false,
  },
  features: {
    disclaimer: false,
    suggestions: [
      { title: T.suggestionLongStayTitle, message: T.suggestionLongStayMessage },
      { title: T.suggestionLoyaltyTitle, message: T.suggestionLoyaltyMessage },
      { title: T.suggestionStatusTitle, message: T.suggestionStatusMessage },
    ],
  },
} satisfies AiChatProps
