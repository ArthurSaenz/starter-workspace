import type { CopilotChatProps, CopilotKitProviderProps } from '@copilotkit/react-core/v2'

import type { AiChatFeatures } from '../ai-chat/index.js'

// Re-exported so the catalogue barrel keeps naming the switches the registry rows point at.
export type { AiChatFeatures }

export const FEATURE_STATUSES = [
  'on',
  'on-with-caveat',
  'off-by-default',
  'backend-blocked',
  'not-applicable',
  'out-of-scope',
] as const

export type FeatureStatus = (typeof FEATURE_STATUSES)[number]

/**
 * `lambda-route` = the allow-list, `lambda-backend` = adapter/graph/service, `license` = CopilotKit
 * Intelligence, `transport` = the buffered Lambda.
 */
export type BlockedBy = 'lambda-route' | 'lambda-backend' | 'license' | 'transport'

export type AreaId =
  | 'surfaces'
  | 'suggestions'
  | 'tools'
  | 'hitl'
  | 'context'
  | 'threads'
  | 'composer'
  | 'messages'
  | 'theming'
  | 'runtime'
  | 'errors'
  | 'not-exposed'

export interface Area {
  id: AreaId
  /** Storybook folder name under `ai-chat/` — never contains `&` or `/`. */
  title: string
}

/** The id prefixes the plan's catalogue uses; an area groups several (Area 1 holds `surface.*` and `copy.*`). */
export type FeatureIdPrefix =
  | 'surface'
  | 'copy'
  | 'suggestions'
  | 'tools'
  | 'genui'
  | 'hitl'
  | 'context'
  | 'state'
  | 'threads'
  | 'composer'
  | 'messages'
  | 'theme'
  | 'runtime'
  | 'errors'
  | 'obs'
  | 'control'
  | 'cloud'
  | 'dev'
  | 'misc'

export type Seam =
  | { kind: 'chat'; prop: Extract<keyof CopilotChatProps, string>; path?: string }
  | { kind: 'provider'; prop: Extract<keyof CopilotKitProviderProps, string> }
  | { kind: 'features'; prop: keyof AiChatFeatures }
  | { kind: 'top'; prop: 'runtimeUrl' | 'agentId' | 'surface' | 'context' | 'theme' | 'onError' | 'className' }
  | { kind: 'children'; hook: string }
  | { kind: 'none' }

export interface Feature {
  id: `${FeatureIdPrefix}.${string}`
  area: AreaId
  /** Storybook story name under the area folder — never contains `/`. */
  title: string
  summary: string
  status: FeatureStatus
  blockedBy?: readonly [BlockedBy, ...BlockedBy[]]
  seam: Seam
  /** Story export names the feature's stories file must carry; empty for `not-applicable`. */
  stories: readonly string[]
  /** The CopilotKit primitive(s) behind the feature, as shown on the Docs page. */
  docs: string
  caveat?: string
}
