import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { ChatFailureComponent } from '../components/chat-failure-component.js'

// The container used to render this <p> inline; the attribute set and the exact class string are
// what ai-chat-states.test.tsx and the client e2e select on, so the extraction pins them here.
describe('chatFailureComponent', () => {
  it('renders the alert line exactly as the container did inline', async () => {
    const screen = await render(<ChatFailureComponent failure={{ kind: 'throttled', text: 'Too many requests' }} />)
    const line = screen.getByRole('alert')

    await expect.element(line).toHaveAttribute('data-testid', 'ai-chat-error')
    await expect.element(line).toHaveAttribute('data-kind', 'throttled')
    await expect.element(line).toHaveAttribute('class', 'px-4 py-2 text-center text-sm text-red-700')
    await expect.element(line).toHaveTextContent('Too many requests')
  })

  it('appends a consumer className after the defaults', async () => {
    const screen = await render(<ChatFailureComponent failure={{ kind: 'offline', text: 'x' }} className="mt-2" />)

    await expect
      .element(screen.getByRole('alert'))
      .toHaveAttribute('class', 'px-4 py-2 text-center text-sm text-red-700 mt-2')
  })
})
