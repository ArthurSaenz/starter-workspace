import type { ReactToolCallRenderer } from '@copilotkit/react-core/v2'
import { createElement } from 'react'

import type { ToolCallLineLabels, ToolCallLineProps } from '../components/tool-call-line.js'
import { ToolCallLine } from '../components/tool-call-line.js'

export interface ToolCallRenderersOptions {
  labels?: ToolCallLineLabels
}

/**
 * One wildcard (`name: "*"`) `renderToolCalls` entry: every tool call the agent makes renders the
 * neutral `ToolCallLine` unless a consumer registers its own renderer for that name first —
 * CopilotKit always prefers an exact match over `*` (`useRenderToolCall`). `T` is left as `any`
 * because a wildcard renderer has no single argument schema to type it against; the exported type
 * is the provider's own `ReactToolCallRenderer<any>[]`, matching `renderToolCalls`.
 */
export const toolCallRenderers = (options?: ToolCallRenderersOptions): ReactToolCallRenderer<any>[] => {
  const labels = options?.labels

  const render = (props: Omit<ToolCallLineProps, 'labels' | 'className'>) => {
    return createElement(ToolCallLine, { ...props, labels })
  }

  return [{ name: '*', render }]
}
