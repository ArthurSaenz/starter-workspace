import { useCopilotKit } from '@copilotkit/react-core/v2'
import type { ReactActivityMessageRenderer } from '@copilotkit/react-core/v2'
import { createElement } from 'react'
import type { ComponentProps, ReactElement } from 'react'

import { A2UI_SURFACE_ACTIVITY_TYPE } from '../services/libs.js'

export type A2uiSurfaceGuardContainerProps = ComponentProps<ReactActivityMessageRenderer<unknown>['render']>

/**
 * The `a2ui-surface` renderer `AIChatRootContainer` puts ahead of react-core's own: its content schema
 * (`a2uiSurfaceContentSchema`) has already blanked every component outside the allowed set, and this
 * hands the cleaned surface on to the built-in renderer — which exists once `/info` turns A2UI on or
 * the host passes a catalog (`extendBasicA2uiCatalog`), whose components are then the allowed set for
 * its protocol (`a2uiAllowedComponents`).
 */
// The explicit return type keeps the emitted .d.ts free of @ag-ui/core, which CI's pnpm layout can't name (TS2883).
export const A2uiSurfaceGuardContainer = (props: A2uiSurfaceGuardContainerProps): ReactElement | null => {
  const { copilotkit } = useCopilotKit()

  const builtIn = copilotkit.renderActivityMessages.find((renderer) => {
    return renderer.activityType === A2UI_SURFACE_ACTIVITY_TYPE && renderer.render !== A2uiSurfaceGuardContainer
  })

  if (!builtIn) return null

  const parsed = builtIn.content['~standard'].validate(props.content)

  if (parsed instanceof Promise || parsed.issues) return null

  return createElement(builtIn.render, { ...props, content: parsed.value })
}
