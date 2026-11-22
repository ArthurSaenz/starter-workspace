import { useMemo } from 'react'

import { mergeChatProps, resolveAiChat } from '../services/main.js'
import type { AIChatContainerProps, AiChatFeatures } from '../types.js'
import { AIChatRootContainer } from './ai-chat-root-container.js'

// A consumer's preset plus the traveller's name. The provider, the error line, the pills and the layout
// all live in `AIChatRootContainer`; only the merge is done here.
export const AIChatContainer = (props: AIChatContainerProps) => {
  const { preset, userName, className, chat, children } = props

  // The chat-shaping switches are baked into the resolved `chat`, so a consumer's explicit slot
  // (`chat={{ input: { disclaimer } }}`) wins over them; the other features reach the root untouched.
  const { presetChat, passThroughFeatures } = useMemo(() => {
    return {
      presetChat: resolveAiChat(preset).chat,
      passThroughFeatures: {
        suggestions: preset.features?.suggestions,
        errorLine: preset.features?.errorLine,
      } satisfies AiChatFeatures,
    }
  }, [preset])

  return (
    <AIChatRootContainer
      {...preset}
      chat={mergeChatProps(presetChat, chat)}
      features={passThroughFeatures}
      context={userName ? [{ description: T.userNameContext, value: userName }] : []}
      className={className}
    >
      {children}
    </AIChatRootContainer>
  )
}

const T = {
  userNameContext: 'Name of the signed-in traveller',
}
