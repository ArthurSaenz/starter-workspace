// Preferences with no correctness consequence, so this ADVISES and never blocks. Must NOT export
// `scope = 'segment'`: `(?!.*\|)` allows `grep foo | wc -l`, and segmenting strips the pipe first.

export const name = 'style';

const SUGGESTIONS = [
  [/^grep\b(?!.*\|)/, "Prefer 'rg' (ripgrep) over 'grep' — faster, and it respects .gitignore."],
  [/^find\s+\S+\s+-name\b/, "Prefer 'rg --files | rg pattern' over 'find -name'."],
];

export function check(command) {
  const tips = SUGGESTIONS.filter(([re]) => re.test(command)).map(([, tip]) => `* ${tip}`);
  if (tips.length > 0) {
    return { action: 'advise', context: tips.join('\n') };
  }
  return null;
}
