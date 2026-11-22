import { useEffect, useState } from 'react'
import { spyOn } from 'storybook/test'

interface ConsoleLinesProps {
  method: 'debug' | 'error'
  /** Only lines whose first argument starts with this are shown, e.g. `[ai-chat]` or `[LIFECYCLE]`. */
  prefix: string
  title: string
}

/**
 * Mirrors matching console lines onto the canvas, so a story about what the package logs shows it
 * without opening devtools. The spy calls through, so the lines still reach the real console. Goes in
 * `AIChat`'s `children`.
 */
export const ConsoleLines = (props: ConsoleLinesProps) => {
  const { method, prefix, title } = props

  const [lines, setLines] = useState<{ id: number; text: string }[]>([])

  useEffect(() => {
    const spy = spyOn(console, method)

    const format = (arg: unknown): string => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`
      if (typeof arg === 'string') return arg

      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }

    // Polled rather than pushed from the spy: a library can log while React renders another
    // component, where a state update would warn.
    const timer = setInterval(() => {
      const matching = spy.mock.calls
        .filter((call) => {
          return typeof call[0] === 'string' && call[0].startsWith(prefix)
        })
        // The position is a stable id: the matching lines only ever grow.
        .map((call, id) => {
          return { id, text: call.map(format).join(' ') }
        })

      setLines((current) => {
        return matching.length === current.length ? current : matching
      })
    }, 200)

    return () => {
      clearInterval(timer)
      spy.mockRestore()
    }
  }, [method, prefix])

  return (
    <div className="border-b p-3 text-xs">
      <p className="mb-1 font-medium">{title}</p>
      {lines.length === 0 ? (
        <p className="opacity-60">nothing logged yet</p>
      ) : (
        lines.map((line) => {
          return (
            <p key={line.id} className="font-mono break-all">
              {line.text}
            </p>
          )
        })
      )}
    </div>
  )
}
