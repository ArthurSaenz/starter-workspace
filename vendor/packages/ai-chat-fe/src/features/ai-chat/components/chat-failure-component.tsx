import { cn } from '../../../lib/utils.js'
import type { ChatFailure } from '../types.js'

interface ChatFailureComponentProps {
  failure: ChatFailure
  className?: string
}

export const ChatFailureComponent = (props: ChatFailureComponentProps) => {
  const { failure, className } = props

  return (
    <p
      role="alert"
      data-testid="ai-chat-error"
      data-kind={failure.kind}
      className={cn('px-4 py-2 text-center text-sm text-red-700', className)}
    >
      {failure.text}
    </p>
  )
}
