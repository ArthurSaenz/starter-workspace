import type { Changefreq, SiteIndexConfig, SiteIndexEntry, SiteIndexManifest } from './types.js'
import { CHANGEFREQS, MANIFEST_VERSION } from './types.js'

export class SiteIndexError extends Error {
  readonly issues: string[]

  constructor(message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}\n  - ${issues.join('\n  - ')}` : message)
    this.name = 'SiteIndexError'
    this.issues = issues
  }
}

export interface DuplicateEntry {
  path: string
  keptFrom: string
  droppedFrom: string
}

export interface MergedEntries {
  entries: SiteIndexEntry[]
  duplicates: DuplicateEntry[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isChangefreq = (value: unknown): value is Changefreq => {
  return CHANGEFREQS.includes(value as Changefreq)
}

const getPathIssue = (path: string): string | null => {
  if (!path.startsWith('/') || path.startsWith('//')) return 'must start with a single "/" and carry no host'
  if (path.includes('#')) return 'must not carry a fragment'
  if (/\s/.test(path)) return 'must not contain whitespace'

  return null
}

const parseEntry = (raw: unknown, at: string, issues: string[]): SiteIndexEntry | null => {
  if (!isRecord(raw)) {
    issues.push(`${at}: not an object`)

    return null
  }

  const { path } = raw

  if (typeof path !== 'string') {
    issues.push(`${at}.path: not a string`)

    return null
  }

  const pathIssue = getPathIssue(path)

  if (pathIssue) {
    issues.push(`${at}.path "${path}": ${pathIssue}`)

    return null
  }

  return parseOptionalFields(path, raw, `${at} (${path})`, issues)
}

interface FieldRule {
  isValid: (value: unknown) => boolean
  expected: string
}

const isString = (value: unknown) => {
  return typeof value === 'string'
}

// Strict on purpose: a typo (`titel`) or a wrong type would otherwise vanish from llms.txt silently.
const OPTIONAL_FIELD_RULES: Record<Exclude<keyof SiteIndexEntry, 'path'>, FieldRule> = {
  group: { isValid: isString, expected: 'a string' },
  title: { isValid: isString, expected: 'a string' },
  description: { isValid: isString, expected: 'a string' },
  lastmod: {
    isValid: (value) => {
      return isString(value) && !Number.isNaN(Date.parse(value as string))
    },
    expected: 'an ISO date such as "2026-10-22"',
  },
  llms: {
    isValid: (value) => {
      return typeof value === 'boolean'
    },
    expected: 'true or false',
  },
  changefreq: { isValid: isChangefreq, expected: `one of ${CHANGEFREQS.join(', ')}` },
  priority: {
    isValid: (value) => {
      return typeof value === 'number' && value >= 0 && value <= 1
    },
    expected: 'a number in 0..1',
  },
}

const ENTRY_FIELDS = ['path', ...Object.keys(OPTIONAL_FIELD_RULES)]

const parseOptionalFields = (
  path: string,
  raw: Record<string, unknown>,
  at: string,
  issues: string[],
): SiteIndexEntry => {
  const entry: Record<string, unknown> = { path }

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'path' || value === undefined) continue

    const rule = OPTIONAL_FIELD_RULES[key as keyof typeof OPTIONAL_FIELD_RULES] as FieldRule | undefined

    if (!rule) {
      issues.push(`${at}.${key}: unknown field; allowed: ${ENTRY_FIELDS.join(', ')}`)
      continue
    }

    if (!rule.isValid(value)) {
      issues.push(`${at}.${key}: got ${JSON.stringify(value)}, expected ${rule.expected}`)
      continue
    }

    entry[key] = value
  }

  return entry as unknown as SiteIndexEntry
}

const MANIFEST_FIELDS = ['producer', 'version', 'generatedAt', 'urls']

/** Validates an untrusted manifest body; `source` names it in the error (an S3 key or a file path). */
export const parseManifest = (raw: unknown, source: string): SiteIndexManifest => {
  if (!isRecord(raw)) throw new SiteIndexError(`Manifest ${source} is not a JSON object`)

  const { producer, version, generatedAt, urls } = raw
  const issues = Object.keys(raw)
    .filter((key) => {
      return !MANIFEST_FIELDS.includes(key)
    })
    .map((key) => {
      return `${key}: unknown field; allowed: ${MANIFEST_FIELDS.join(', ')}`
    })

  if (typeof producer !== 'string' || producer.length === 0) issues.push('producer: not a non-empty string')
  if (version !== MANIFEST_VERSION) issues.push(`version: expected ${MANIFEST_VERSION}, got ${String(version)}`)
  if (typeof generatedAt !== 'string') issues.push('generatedAt: not a string')
  if (!Array.isArray(urls)) issues.push('urls: not an array')

  const entries = Array.isArray(urls)
    ? urls.flatMap((item: unknown, index) => {
        return parseEntry(item, `urls[${index}]`, issues) ?? []
      })
    : []

  if (issues.length > 0) throw new SiteIndexError(`Manifest ${source} is invalid`, issues)

  return {
    producer: producer as string,
    version: MANIFEST_VERSION,
    generatedAt: generatedAt as string,
    urls: entries,
  }
}

export const createManifest = (producer: string, urls: SiteIndexEntry[], now = new Date()): SiteIndexManifest => {
  return parseManifest({ producer, version: MANIFEST_VERSION, generatedAt: now.toISOString(), urls }, producer)
}

/**
 * Concatenates manifests in the given order; on a repeated path the first occurrence wins. Callers
 * sort manifests by producer so the winner does not depend on S3 listing or deploy order.
 */
export const mergeManifests = (manifests: SiteIndexManifest[]): MergedEntries => {
  const owners = new Map<string, string>()
  const entries: SiteIndexEntry[] = []
  const duplicates: DuplicateEntry[] = []

  for (const manifest of manifests) {
    for (const entry of manifest.urls) {
      const keptFrom = owners.get(entry.path)

      if (keptFrom !== undefined) {
        duplicates.push({ path: entry.path, keptFrom, droppedFrom: manifest.producer })
        continue
      }

      owners.set(entry.path, manifest.producer)
      entries.push(entry)
    }
  }

  return { entries, duplicates }
}

const isUnderPrefix = (path: string, prefix: string): boolean => {
  return (
    path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || path.startsWith(`${prefix}?`)
  )
}

export const findDisallowedEntries = (entries: SiteIndexEntry[], config: SiteIndexConfig): string[] => {
  return entries.flatMap((entry) => {
    const prefix = config.disallow.find((item) => {
      return isUnderPrefix(entry.path, item)
    })

    return prefix ? [`${entry.path} (under disallowed ${prefix})`] : []
  })
}
