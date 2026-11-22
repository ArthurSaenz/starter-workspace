import type { AiChatTheme } from '../types.js'

// The 33 custom properties `@copilotkit/react-core/dist/v2/index.css` declares on `[data-copilotkit]`
// (the block that sets `--background: oklch(…)`, in declaration order). Anything else set on an
// ancestor is inert: CopilotKit re-declares every token on its own root.
export const AI_CHAT_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'radius',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const

/**
 * The `<style>` text for one chat instance, or `undefined` when no token is set. `chat` scope
 * reaches the roots inside the wrapper; `host` doubles the attribute selector to (0,2,0) so it
 * also wins over CopilotKit's own `.dark [data-copilotkit]` rule on the portalled roots at `<body>`.
 */
export const themeCss = (id: string, theme: AiChatTheme | undefined): string | undefined => {
  const tokens = theme?.tokens

  if (!tokens) return undefined

  const declarations = AI_CHAT_TOKENS.filter((token) => {
    return tokens[token] !== undefined
  }).map((token) => {
    return `--${token}:${tokens[token]}`
  })

  if (declarations.length === 0) return undefined

  const selector =
    theme.scope === 'host' ? '[data-copilotkit][data-copilotkit]' : `[data-ai-chat="${id}"] [data-copilotkit]`

  return `${selector}{${declarations.join(';')}}`
}
