import { cn } from '../../../lib/utils.js'

export interface ToolCallLineProps {
  name: string
  args: Record<string, unknown>
  status: string
  result: string | undefined
  /** Re-words the two built-in templates; the package itself never assumes product copy. */
  labels?: ToolCallLineLabels
  className?: string
}

/**
 * The one line every tool call gets when nothing more specific is registered for it: a neutral,
 * product-copy-free status (`data-testid="chat-tool-call"`, `data-tool-name`, `data-tool-status`)
 * a screen reader announces on its own (`role="status"`, `aria-live="polite"`). Meant to be
 * registered through `toolCallRenderers()`, not mounted directly by a consumer.
 */
export const ToolCallLine = (props: ToolCallLineProps) => {
  const { name, status, labels, className } = props

  const humanName = humanise(name)

  const label =
    status === 'complete'
      ? (labels?.complete ?? defaultComplete)(humanName)
      : (labels?.inProgress ?? defaultInProgress)(humanName)

  return (
    <div
      data-testid="chat-tool-call"
      data-tool-name={name}
      data-tool-status={status}
      role="status"
      aria-live="polite"
      // Not `var(--muted-foreground)`: CopilotKit v2 re-declares every shadcn-named token on
      // `[data-copilotkit]`, so the bare name resolves to CopilotKit's own grey. `--color-*` is
      // the host's `@theme inline` namespace, which CopilotKit never touches.
      className={cn('text-muted-foreground text-sm', className)}
    >
      {label}
    </div>
  )
}

export interface ToolCallLineLabels {
  /** `(humanisedName) => text` while the call is `inProgress` or `executing`. */
  inProgress?: (name: string) => string
  /** `(humanisedName) => text` once the call is `complete`. */
  complete?: (name: string) => string
}

// A tool name is camelCase, dot- or underscore-separated (`lookupLoyaltyBalance`,
// `loyalty_facts`) — never a phrase a traveller should read verbatim, so this is the only copy
// this component invents on top of the two templates.
const humanise = (name: string): string => {
  return name
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
}

const defaultInProgress = (name: string): string => {
  return `Looking up ${name}…`
}

const defaultComplete = (name: string): string => {
  return `Checked ${name}`
}
