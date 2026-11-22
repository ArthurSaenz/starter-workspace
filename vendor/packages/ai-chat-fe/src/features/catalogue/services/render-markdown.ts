import type { Feature, FeatureStatus, Seam } from '../types.js'
import { FEATURE_STATUSES } from '../types.js'
import { AREAS } from './areas.js'

export const seamLabel = (seam: Seam): string => {
  switch (seam.kind) {
    case 'chat':
      return seam.path ? `chat.${seam.prop}.${seam.path}` : `chat.${seam.prop}`
    case 'provider':
      return `provider.${seam.prop}`
    case 'features':
      return `features.${seam.prop}`
    case 'top':
      return seam.prop
    case 'children':
      return `children (${seam.hook})`
    case 'none':
      return '—'
  }
}

export const statusLabel = (feature: Feature): string => {
  return feature.blockedBy ? `${feature.status} (${feature.blockedBy.join(', ')})` : feature.status
}

export const countByStatus = (features: readonly Feature[]): Readonly<Record<FeatureStatus, number>> => {
  const counts = Object.fromEntries(
    FEATURE_STATUSES.map((status) => {
      return [status, 0]
    }),
  ) as Record<FeatureStatus, number>

  for (const feature of features) counts[feature.status] += 1

  return counts
}

// Pipes would end the cell early; nothing else needs escaping because every free-text cell is
// plain prose or inline code, which prettier leaves alone when it re-aligns the columns.
const cell = (text: string): string => {
  return text.replaceAll('|', '\\|')
}

const row = (cells: readonly string[]): string => {
  return `| ${cells.map(cell).join(' | ')} |`
}

const featureRow = (feature: Feature): string => {
  const status = feature.caveat ? `${statusLabel(feature)} — ${feature.caveat}` : statusLabel(feature)

  const stories =
    feature.stories.length > 0
      ? feature.stories
          .map((name) => {
            return `\`${name}\``
          })
          .join(', ')
      : '—'

  return row([feature.title, feature.summary, status, `\`${seamLabel(feature.seam)}\``, stories])
}

/**
 * The README block between `<!-- catalogue:start -->` and `<!-- catalogue:end -->`: one table per
 * area, counts derived from the registry. `scripts/render-catalogue.mjs` writes it and prettier
 * re-aligns the columns, so a consumer compares cell-trimmed (`catalogue-readme.test.ts`).
 */
export const renderCatalogueMarkdown = (features: readonly Feature[]): string => {
  const counts = countByStatus(features)

  const areas = AREAS.filter((area) => {
    return features.some((feature) => {
      return feature.area === area.id
    })
  })

  const summary = FEATURE_STATUSES.map((status) => {
    return `${counts[status]} ${status}`
  }).join(', ')

  const lines = [
    `_${features.length} features in ${areas.length} areas: ${summary}. Generated from \`src/features/catalogue/services/registry.ts\` by \`pnpm --filter @wl/ai-chat-fe catalogue\` — do not edit by hand._`,
  ]

  for (const area of areas) {
    lines.push(
      '',
      `### ${area.title}`,
      '',
      row(['Feature', 'Summary', 'Status', 'Seam', 'Stories']),
      row(['---', '---', '---', '---', '---']),
    )
    for (const feature of features) {
      if (feature.area === area.id) lines.push(featureRow(feature))
    }
  }

  return lines.join('\n')
}
