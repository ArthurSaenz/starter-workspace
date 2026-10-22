import { toAbsoluteUrl } from './sitemap.js'
import type { SiteIndexConfig, SiteIndexEntry } from './types.js'

const DEFAULT_SECTION_TITLE = 'Pages'
const OPTIONAL_SECTION_TITLE = 'Optional'

// Markdown link text cannot carry an unescaped `]`, and a newline would end the list item.
const toLinkText = (value: string): string => {
  return value.replaceAll(/\s+/g, ' ').replaceAll(/[[\]]/g, '\\$&').trim()
}

const renderLink = (entry: SiteIndexEntry, config: SiteIndexConfig): string => {
  const link = `- [${toLinkText(entry.title ?? entry.path)}](${toAbsoluteUrl(config.origin, entry.path)})`

  return entry.description ? `${link}: ${entry.description.replaceAll(/\s+/g, ' ').trim()}` : link
}

const renderSection = (title: string, entries: SiteIndexEntry[], config: SiteIndexConfig): string[] => {
  if (entries.length === 0) return []

  return [
    `## ${title}`,
    '',
    ...entries.map((entry) => {
      return renderLink(entry, config)
    }),
    '',
  ]
}

/** llms.txt per https://llmstxt.org: H1 name, blockquote summary, prose, then H2 link lists. */
export const renderLlmsTxt = (entries: SiteIndexEntry[], config: SiteIndexConfig): string => {
  const { llms } = config
  const optionalGroups = new Set(llms.optionalGroups)
  const knownGroups = new Set(
    llms.sections.map((section) => {
      return section.group
    }),
  )
  const listed = entries.filter((entry) => {
    return entry.llms !== false
  })
  const inGroup = (group: string) => {
    return listed.filter((entry) => {
      return entry.group === group
    })
  }

  const ungrouped = listed.filter((entry) => {
    return !entry.group || (!knownGroups.has(entry.group) && !optionalGroups.has(entry.group))
  })

  const sections = llms.sections
    .filter((section) => {
      return !optionalGroups.has(section.group)
    })
    .flatMap((section) => {
      return renderSection(section.title, inGroup(section.group), config)
    })

  const optional = listed.filter((entry) => {
    return entry.group !== undefined && optionalGroups.has(entry.group)
  })

  const lines = [
    `# ${config.name}`,
    '',
    `> ${llms.summary.replaceAll(/\s+/g, ' ').trim()}`,
    '',
    ...(llms.details ?? []).flatMap((paragraph) => {
      return [paragraph, '']
    }),
    ...renderSection(llms.defaultSectionTitle ?? DEFAULT_SECTION_TITLE, ungrouped, config),
    ...sections,
    ...renderSection(OPTIONAL_SECTION_TITLE, optional, config),
  ]

  return lines.join('\n')
}
