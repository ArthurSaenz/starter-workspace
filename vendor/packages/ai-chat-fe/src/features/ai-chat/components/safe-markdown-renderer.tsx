import { CopilotChatAssistantMessage } from '@copilotkit/react-core/v2'
import type { ComponentProps } from 'react'

import { NO_RAW_HTML, SAFE_COMPONENTS } from '../../../markdown/index.js'

export type SafeMarkdownRendererProps = ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>

/**
 * CopilotKit's Streamdown renderer with the `SafeMarkdown` hardening: no images, links only for
 * `https:` and `mailto:`, raw HTML dropped. The overrides are applied last, so a caller's `components`
 * or `remarkRehypeOptions` cannot re-open them.
 */
export const SafeMarkdownRenderer = (props: SafeMarkdownRendererProps) => {
  return (
    <CopilotChatAssistantMessage.MarkdownRenderer
      {...props}
      components={SAFE_COMPONENTS}
      remarkRehypeOptions={NO_RAW_HTML}
    />
  )
}
