import process from 'node:process'

type KVMap = Record<string, unknown>

/**
 * How much of a run's text LangSmith may keep. `anonymize`: readable text with personal data (emails,
 * phones, card and other long numbers, booking references) and secrets replaced by a placeholder.
 * `text`: the text as written, secrets still replaced — for dev and prod, read to debug real chats.
 */
export type TraceMaskingMode = 'anonymize' | 'text'

/**
 * The mode for a LangSmith project. The host names the project per stage (`<app>-${stage}`), so the
 * stage needs no env var of its own. Only a `-dev` or `-prod` project keeps text: preview stages, local
 * runs and an unset project all anonymize.
 */
export const traceMaskingModeFor = (projectName: string | undefined): TraceMaskingMode => {
  return projectName !== undefined && /-(?:dev|prod)$/u.test(projectName) ? 'text' : 'anonymize'
}

// Strings under these keys are structure, not content: message classes and roles, tool names and
// call ids, model ids and stop reasons. Every other string is scrubbed.
const STRUCTURAL_KEYS = new Set([
  'id',
  'lc',
  'type',
  'role',
  'name',
  'tool_call_id',
  'model',
  'model_name',
  'stop_reason',
  'finish_reason',
  'status',
])

// A tool call's arguments are the traveller's words (a memory to keep, a question), whatever the key.
const FREE_TEXT_KEYS = new Set(['args'])

type Rule = readonly [pattern: RegExp, replace: (match: string, ...groups: string[]) => string]

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const BOOKING_KEYWORD = /^(?:confirmation|booking|reservation|itinerary|pnr|ref|reference|number|code)$/i
const BOOKING_CODE = /^[\dA-Z][\dA-Z-]{4,19}$/i

const passesLuhn = (digits: string): boolean => {
  let sum = 0

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index])
    const doubled = index % 2 === 1 ? digit * 2 : digit

    sum += doubled > 9 ? doubled - 9 : doubled
  }

  return sum % 10 === 0
}

const SECRET_RULES: readonly Rule[] = [
  [
    /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]+/g,
    () => {
      return '[jwt]'
    },
  ],
  [
    /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi,
    (_match, scheme) => {
      return `${scheme} [secret]`
    },
  ],
  // Provider-prefixed keys (Anthropic/OpenAI `sk-`, LangSmith `lsv2_`, GitHub, Slack, AWS, Google).
  ...[/\b(?:sk|pk|rk|lsv2)[-_][\w-]{16,}/g, /\b(?:gh[opsu]_|xox[abprs]-)[\w-]{10,}/g, /\b(?:AKIA|AIza)[\w-]{16,}/g].map(
    (pattern): Rule => {
      return [
        pattern,
        () => {
          return '[secret]'
        },
      ]
    },
  ),
  // Any other long mixed letters-and-digits token reads as a key; a UUID is an id the trace needs.
  [
    /\b[\w-]{32,}\b/g,
    (match) => {
      return /\d/.test(match) && /[a-z]/i.test(match) && !UUID.test(match) ? '[secret]' : match
    },
  ],
]

const DATE = /^(?:\d{4}([.-])\d{1,2}\1\d{1,2}|\d{1,2}([.-])\d{1,2}\2\d{4})$/
const YEARS = /^(?:(?:19|20)\d{2}[ .-]?)+$/
const THOUSANDS = /^\d{1,3}(?:[ .]\d{3})+$/

// Seven digits or more is a phone or a document number; a date, a span of years or a grouped price is not.
const isGroupedPersonalNumber = (match: string): boolean => {
  return match.replaceAll(/\D/g, '').length >= 7 && !DATE.test(match) && !YEARS.test(match) && !THOUSANDS.test(match)
}

const PII_RULES: readonly Rule[] = [
  // Whole tokens, checked in code: an unanchored email pattern backtracks on long text.
  [
    /[^\s"'(),:;<>]+/g,
    (token) => {
      const at = token.indexOf('@')
      const trailingDot = token.endsWith('.') ? '.' : ''
      const domain = token.slice(at + 1, token.length - trailingDot.length)

      return at > 0 && domain.includes('.') && !domain.includes('@') ? `[email]${trailingDot}` : token
    },
  ],
  // The first code-like token (has a digit, or is all capitals) shortly after a booking keyword.
  [
    /\b(?:confirmation|booking|reservation|itinerary|pnr|ref|reference)\b[^\n]{0,30}/gi,
    (window) => {
      let masked = false

      return window.replace(/[\w-]+/g, (word) => {
        if (masked || BOOKING_KEYWORD.test(word) || !BOOKING_CODE.test(word)) return word
        if (!/\d/.test(word) && word !== word.toUpperCase()) return word

        masked = true

        return '[booking-ref]'
      })
    },
  ],
  // Four-digit groups (or one unbroken run) of card length: a Luhn pass is a card, anything else a number.
  [
    /\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b/g,
    (match) => {
      return passesLuhn(match.replaceAll(/\D/g, '')) ? '[card]' : '[number]'
    },
  ],
  // Amex groups its 15 digits 4-6-5.
  [
    /\b\d{4}([ -]?)\d{6}\1\d{5}\b/g,
    (match) => {
      return passesLuhn(match.replaceAll(/\D/g, '')) ? '[card]' : '[number]'
    },
  ],
  [
    /\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,4}\b/g,
    () => {
      return '[phone]'
    },
  ],
  [
    /\(\d{3}\)\s?\d{3}[\s.-]\d{4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b/g,
    () => {
      return '[phone]'
    },
  ],
  // Local phones and numbers written in groups (`050 123 4567`, `06 12 34 56 78`, `(050) 123 45 67`);
  // one separator throughout, so two dates side by side read as two dates, not one long number.
  ...[
    /(?<![\w-])\(\d{2,4}\) ?\d{2,4}(?:([ .-])\d{2,4}(?:\1\d{2,4}){0,3})?(?![\w-])/g,
    /(?<![\w-])\d{2,4}([ .-])\d{2,4}(?:\1\d{2,4}){0,4}(?![\w-])/g,
  ].map((pattern): Rule => {
    return [
      pattern,
      (match) => {
        return isGroupedPersonalNumber(match) ? '[phone]' : match
      },
    ]
  }),
  // Passport, account and loyalty-member numbers; prices and years are shorter, and a UUID's
  // all-digit last group is part of an id.
  [
    /(?<![\da-f]{4}-)\b\d{9,}\b/gi,
    () => {
      return '[number]'
    },
  ],
  // Booking codes and document numbers mixing letters with digits (`523456789X`, `C01X00T47`); a
  // token with a dash or underscore is an id or a slug (UUIDs, tool-call ids), not a code.
  [
    /[\w-]+/g,
    (token) => {
      const digits = token.replaceAll(/\D/g, '').length

      return digits >= 6 && /[a-z]/i.test(token) && !/[-_]/.test(token) ? '[number]' : token
    },
  ],
]

const RULES_BY_MODE: Record<TraceMaskingMode, readonly Rule[]> = {
  text: SECRET_RULES,
  anonymize: [...SECRET_RULES, ...PII_RULES],
}

/** A piece of trace text with the mode's secrets and personal data replaced by placeholders. */
export const scrubTraceText = (text: string, mode: TraceMaskingMode): string => {
  return RULES_BY_MODE[mode].reduce<string>((scrubbed, [pattern, replace]) => {
    return scrubbed.replace(pattern, replace as (match: string) => string)
  }, text)
}

interface Walk {
  mode: TraceMaskingMode
  ancestors: WeakSet<object>
}

const scrubObject = (value: object, key: string, freeText: boolean, walk: Walk): unknown => {
  // A LangChain message serializes to `{ lc, type, id, kwargs }`, the shape LangSmith renders as a chat.
  const plain: unknown =
    'toJSON' in value && typeof value.toJSON === 'function' ? (value.toJSON as () => unknown)() : value

  if (typeof plain !== 'object' || plain === null) return scrubValue(plain, key, freeText, walk)
  if (Array.isArray(plain)) {
    return plain.map((item) => {
      return scrubValue(item, key, freeText, walk)
    })
  }

  return Object.fromEntries(
    Object.entries(plain).map(([childKey, child]) => {
      return [childKey, scrubValue(child, childKey, freeText || FREE_TEXT_KEYS.has(childKey), walk)]
    }),
  )
}

function scrubValue(value: unknown, key: string, freeText: boolean, walk: Walk): unknown {
  if (typeof value === 'string') return !freeText && STRUCTURAL_KEYS.has(key) ? value : scrubTraceText(value, walk.mode)
  if (value === null || typeof value !== 'object') return value
  // Only a true cycle: the same object met twice side by side (a message's content) is kept both times.
  if (walk.ancestors.has(value)) return '[circular]'

  walk.ancestors.add(value)

  try {
    return scrubObject(value, key, freeText, walk)
  } finally {
    walk.ancestors.delete(value)
  }
}

/**
 * A run's inputs or outputs as LangSmith may keep them: the same shape — messages, their roles, tool
 * names and call ids, token counts and other numbers — with each piece of text passed through
 * `scrubTraceText` for the mode.
 */
export const scrubTraceValues = (values: KVMap, mode: TraceMaskingMode): KVMap => {
  return scrubValue(values, '', false, { mode, ancestors: new WeakSet() }) as KVMap
}

/**
 * One installed copy of @langchain/core. pnpm installs core once per peer-dependency variant (the
 * travel agent's copy resolves another zod than this package's), and each copy keeps its own
 * LangSmith client and callback queue — so a host hands over the copy its graph runs on.
 */
export interface LangChainCoreCopy {
  /** That copy's `@langchain/core/tracers/tracer_langchain` export. */
  LangChainTracer: new () => { client: object }
  /** That copy's `@langchain/core/callbacks/promises` export. */
  awaitAllCallbacks: () => Promise<void>
}

const tracedCopies = new Set<LangChainCoreCopy>()

/** The core copies `maskTraceContent` was handed, for `flushTraces` to drain besides its own. */
export const tracedCoreCopies = (): readonly LangChainCoreCopy[] => {
  return [...tracedCopies]
}

/**
 * Makes LangSmith receive `scrubTraceValues` of every run's inputs and outputs instead of the raw
 * text, from this package's @langchain/core copy and from each of `copies`. Core builds its tracing
 * client internally with no masking hook, so the client's own `hideInputs` / `hideOutputs` options are
 * set on that instance; a test pins that it still takes them. Masks nothing with tracing off, where
 * the LangSmith client is never loaded.
 */
export const maskTraceContent = async (
  copies: readonly LangChainCoreCopy[] = [],
  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  mode: TraceMaskingMode = traceMaskingModeFor(process.env['LANGSMITH_PROJECT']),
): Promise<void> => {
  // Any client this never reaches (a core copy no host handed over, langsmith's own `traceable` one)
  // then drops inputs and outputs whole: langsmith reads these when it builds a client.
  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  process.env['LANGSMITH_HIDE_INPUTS'] ??= 'true'
  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  process.env['LANGSMITH_HIDE_OUTPUTS'] ??= 'true'

  // eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature
  if (process.env['LANGSMITH_TRACING'] !== 'true') return

  const { LangChainTracer } = await import('@langchain/core/tracers/tracer_langchain')

  const tracers = [
    LangChainTracer,
    ...copies.map((copy) => {
      return copy.LangChainTracer
    }),
  ]

  const scrub = (values: KVMap): KVMap => {
    return scrubTraceValues(values, mode)
  }

  for (const Tracer of tracers) {
    Object.assign(new Tracer().client, { hideInputs: scrub, hideOutputs: scrub })
  }

  for (const copy of copies) tracedCopies.add(copy)
}
