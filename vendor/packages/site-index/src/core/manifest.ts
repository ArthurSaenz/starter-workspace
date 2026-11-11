import { SiteIndexError } from './errors.js'
import type { Changefreq, SiteIndexConfig, SiteIndexEntry, SiteIndexManifest } from './types.js'
import { CHANGEFREQS, MANIFEST_VERSION } from './types.js'

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

// URL parsing resolves these exactly like "." and "..", so `/a/%2e%2e/checkout` is `/checkout`.
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i

const hasDotSegment = (path: string): boolean => {
  const [pathname = ''] = path.split('?')

  return pathname.split('/').some((segment) => {
    return DOT_SEGMENT.test(segment)
  })
}

const getPathIssue = (path: string): string | null => {
  if (!path.startsWith('/') || path.startsWith('//')) return 'must start with a single "/" and carry no host'
  // URL parsing reads "\" as "/", so `/\evil.com` would resolve to another host.
  if (path.includes('\\')) return 'must not contain a backslash'
  if (path.includes('#')) return 'must not carry a fragment'
  if (/\s/.test(path)) return 'must not contain whitespace'
  if (hasDotSegment(path)) return 'must not contain "." or ".." segments'

  return null
}

// The producer names the manifest file (`<producer>.json`) on disk and in S3.
const getProducerIssue = (producer: unknown): string | null => {
  if (typeof producer !== 'string' || producer.length === 0) return 'producer: not a non-empty string'
  if (/[/\\]/.test(producer) || DOT_SEGMENT.test(producer)) return `producer "${producer}": not usable as a file name`

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

// The sitemap protocol takes only W3C Datetime (https://www.w3.org/TR/NOTE-datetime): a time needs a zone.
const W3C_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/
const W3C_TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const W3C_ZONE = /^[+-](?:[01]\d|2[0-3]):[0-5]\d$/

const isW3cDate = (value: string): boolean => {
  if (!W3C_DATE.test(value)) return false

  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const isW3cTime = (value: string): boolean => {
  const match = W3C_TIME.exec(value)

  if (!match) return false

  const [, hour, minute, second = '0', zone = ''] = match

  return Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && (zone === 'Z' || W3C_ZONE.test(zone))
}

const isW3cDatetime = (value: unknown): boolean => {
  if (typeof value !== 'string') return false

  const [date = '', time, ...rest] = value.split('T')

  if (rest.length > 0 || !isW3cDate(date)) return false

  // A time is only defined on a full date (YYYY-MM-DDThh:mm...).
  return time === undefined || (date.length === 10 && isW3cTime(time))
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
    isValid: isW3cDatetime,
    expected: 'a W3C Datetime such as "2026-10-22" or "2026-10-22T09:11:00Z"',
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

  const producerIssue = getProducerIssue(producer)

  if (producerIssue) issues.push(producerIssue)
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

// Crawlers match robots rules on the decoded path, so `/%63heckout` is `/checkout` to them.
const decodePath = (path: string): string => {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

export const findDisallowedEntries = (entries: SiteIndexEntry[], config: SiteIndexConfig): string[] => {
  return entries.flatMap((entry) => {
    const decoded = decodePath(entry.path)

    const prefix = config.disallow.find((item) => {
      return isUnderPrefix(entry.path, item) || isUnderPrefix(decoded, item)
    })

    return prefix ? [`${entry.path} (under disallowed ${prefix})`] : []
  })
}
