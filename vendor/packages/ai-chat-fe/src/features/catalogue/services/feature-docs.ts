import type { CopilotKitProviderProps } from '@copilotkit/react-core/v2'
import { CopilotChatDefaultLabels } from '@copilotkit/react-core/v2/headless'

import type { Feature } from '../types.js'
import { seamLabel, statusLabel } from './render-markdown.js'

// Browser-only: react-core is not loadable under plain node (its `.css` import), so this module
// stays out of `services/main.ts` and is reached through the feature barrel.

type ProviderErrorCode = `${Parameters<NonNullable<CopilotKitProviderProps['onError']>>[0]['code']}`

// The enum lives in `@copilotkit/core`, which is not a dependency of this package. Keying an object
// by the enum's template-literal type makes tsc reject a stale or misspelled list: a code added or
// removed upstream fails the build here.
const ERROR_CODES = {
  runtime_info_fetch_failed: true,
  agent_connect_failed: true,
  agent_run_failed: true,
  agent_run_failed_event: true,
  agent_run_error_event: true,
  tool_argument_parse_failed: true,
  tool_handler_failed: true,
  tool_not_found: true,
  agent_not_found: true,
  agent_thread_locked: true,
  transcription_failed: true,
  transcription_service_not_configured: true,
  transcription_invalid_audio: true,
  transcription_rate_limited: true,
  transcription_auth_failed: true,
  transcription_network_error: true,
  subscriber_callback_failed: true,
  header_resolution_failed: true,
} satisfies Record<ProviderErrorCode, true>

export const labelKeys = (): readonly string[] => {
  return Object.keys(CopilotChatDefaultLabels)
}

export const errorCodes = (): readonly string[] => {
  return Object.keys(ERROR_CODES)
}

const codeList = (items: readonly string[]): string => {
  return items
    .map((item) => {
      return `\`${item}\``
    })
    .join(', ')
}

/** Markdown for the feature's Storybook Docs page (`parameters.docs.description.component`). */
export const featureDocs = (feature: Feature): string => {
  const stories = feature.stories.length > 0 ? codeList(feature.stories) : '—'

  const lines = [
    `**${feature.title}** — ${feature.summary}`,
    '',
    `Status: \`${statusLabel(feature)}\` · Seam: \`${seamLabel(feature.seam)}\` · Stories: ${stories}`,
    '',
    feature.docs,
  ]

  if (feature.caveat) lines.push('', `Caveat: ${feature.caveat}`)
  if (feature.id === 'copy.labels') {
    const keys = labelKeys()

    lines.push('', `Label keys (${keys.length}, read from \`CopilotChatDefaultLabels\`): ${codeList(keys)}`)
  }
  if (feature.id === 'errors.onError') {
    const codes = errorCodes()

    lines.push('', `Error codes (${codes.length}, derived from \`CopilotKitCoreErrorCode\`): ${codeList(codes)}`)
  }

  return lines.join('\n')
}
