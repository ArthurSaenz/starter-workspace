// Pure parsing/formatting for the edit pipeline's report. Two rules throughout: "failed to run" and
// "found problems" are never collapsed, and PARSE-PRESENCE decides which, not the exit code.

// Tolerant by contract — status 2 gives empty stdout, a crash gives anything, and both must yield
// "no findings" rather than throw the whole report away.
//
// STDOUT IS NOT PURE JSON HERE: pnpm's catalog resolution prints `Dependency "react" could not be
// resolved…` ahead of the array. The scan is LINE-ORIENTED, not a `[`-to-`]` slice, because the
// array is on ONE line and a bracket in pnpm's warning text would defeat a slice.
function extractJsonPayload(stdout) {
  const text = (stdout ?? '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Not pure JSON — fall through to the line scan.
  }

  for (const line of text.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('[')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // A noise line that merely begins with a bracket; keep looking.
    }
  }

  return null;
}

export function parseEslintJson(stdout) {
  const payload = extractJsonPayload(stdout);

  if (!Array.isArray(payload)) return { errors: 0, messages: [] };

  const messages = [];
  let errors = 0;

  for (const result of payload) {
    for (const message of result?.messages ?? []) {
      // Belt-and-braces past `--quiet`, for fatal parse errors (severity 2, no ruleId).
      if (message.severity !== 2) continue;
      errors += 1;
      messages.push({
        line: message.line ?? 0,
        column: message.column ?? 0,
        ruleId: message.ruleId ?? null,
        message: message.message ?? '',
        fixable: message.fix !== undefined, // detects the prettier/eslint standoff, see edit-pipeline

      });
    }
  }

  return { errors, messages };
}

const TOOL_ERROR_MAX = 300;

// Skips ESLint's banner ("Oops! Something went wrong! :(" / "ESLint: 10.7.0"), which names no cause
// and would otherwise be the one line we emit.
export function extractToolError(stderr) {
  const substantive = (stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^Oops! Something went wrong/.test(line) && !/^ESLint: \d/.test(line));

  if (!substantive) return null;
  return substantive.length > TOOL_ERROR_MAX
    ? `${substantive.slice(0, TOOL_ERROR_MAX)}…`
    : substantive;
}

// A normal state, not a failure — the one status-2 case that stays silent. ESLint prints "couldn't";
// the class also covers "could not" and "couldnt".
export function isMissingConfig(stderr) {
  return /could ?n[o']?t find an eslint\.config/i.test(stderr ?? '');
}

// tsc emits TWO diagnostic shapes; knowing only the first downgrades real errors to "tool failure".
//   file-scoped:    src/x.ts(4,7): error TS2322: Type 'string' is not assignable to type 'number'.
//   program-level:  error TS2688: Cannot find type definition file for 'vite/client'.
// The program-level form has no `file(line,col):` prefix — tsc uses it for whole-program conditions.
const RE_TSC_FILE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const RE_TSC_PROGRAM = /^error (TS\d+): (.*)$/;
// An indented non-blank line is a continuation of the diagnostic above it.
const RE_TSC_CONTINUATION = /^\s+\S/;

export function parseTscDiagnostics(stdout) {
  const diagnostics = [];

  for (const raw of (stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');

    const fileMatch = RE_TSC_FILE.exec(line);
    if (fileMatch) {
      diagnostics.push({
        file: fileMatch[1],
        line: Number(fileMatch[2]),
        column: Number(fileMatch[3]),
        code: fileMatch[4],
        message: fileMatch[5],
        details: [],
      });
      continue;
    }

    const programMatch = RE_TSC_PROGRAM.exec(line);
    if (programMatch) {
      diagnostics.push({
        file: null,
        line: null,
        column: null,
        code: programMatch[1],
        message: programMatch[2],
        details: [],
      });
      continue;
    }

    // For TS2688 the continuations carry the only actionable content; the headline just says a file
    // is missing.
    if (RE_TSC_CONTINUATION.test(line) && diagnostics.length > 0) {
      diagnostics.at(-1).details.push(line.trim());
    }
  }

  return diagnostics;
}

export function formatTscDiagnostic(diagnostic) {
  const head =
    diagnostic.file === null
      ? `error ${diagnostic.code}: ${diagnostic.message}`
      : `${diagnostic.file}(${diagnostic.line},${diagnostic.column}): error ${diagnostic.code}: ${diagnostic.message}`;

  return [head, ...diagnostic.details.map((detail) => `    ${detail}`)].join('\n');
}

// GROUPS, never re-renders. Parsing tsc apart and printing it back was byte-identical except that it
// flattened tsc's own 2/4/6/8 nesting to a uniform 4, which destroys the causal chain in a deep
// mismatch. Blocks exist only so capLines cannot cut a diagnostic in half.
//
// A head must NOT begin with whitespace — that single property is what stops an indented
// continuation from being promoted to a diagnostic. `\S.*?` rather than `.+?` for the same reason:
// `.+?` happily consumes leading indentation, which is how the old parser turned the continuation
//   `    Type '"a.ts(1,1): error TS1005: injected"' is not assignable…`
// into a phantom TS1005 at line 1 of a file that does not exist.
const RE_TSC_HEAD = /^(?:\S.*?\(\d+,\d+\): )?error TS\d+: /;

export function splitTscBlocks(stdout) {
  const blocks = [];

  for (const raw of (stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');

    if (RE_TSC_HEAD.test(line)) blocks.push(line);
    else if (RE_TSC_CONTINUATION.test(line) && blocks.length > 0) {
      blocks[blocks.length - 1] += `\n${line}`;
    }
  }

  return blocks;
}

const TRUNCATION_HINT = 'Full list: pnpm run eslint-check / pnpm run ts-check';

function capLines(lines, maxChars) {
  const kept = [];
  let used = 0;

  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }

  const suppressed = lines.length - kept.length;
  if (suppressed > 0) kept.push(`  … ${suppressed} more suppressed. ${TRUNCATION_HINT}`);
  return kept;
}

// Uncapped, one section eats the budget and the rest vanish: 200 lint errors rendered 3995 chars
// with no `TypeScript:` heading at all.
const DEFAULT_SECTION_MAX_CHARS = 2000;

// Sections are capped BEFORE the report is, so each gets a share rather than the first taking all.
export function formatReport(sections, { maxChars = 4000 } = {}) {
  const blocks = [];

  for (const section of sections) {
    if (!section.lines?.length) continue;
    const lines = capLines(section.lines, section.maxChars ?? DEFAULT_SECTION_MAX_CHARS);
    blocks.push([section.title, ...lines].join('\n'));
  }

  const report = blocks.join('\n\n');
  if (report.length <= maxChars) return report;

  return `${report.slice(0, maxChars - TRUNCATION_HINT.length - 8)}\n… ${TRUNCATION_HINT}`;
}
