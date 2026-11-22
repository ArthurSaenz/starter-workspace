import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { ToolCallLine } from '../components/tool-call-line.js'

// The DOM contract other lanes select on (Fixed contracts, .omc/plans/autopilot-impl.md): a fake
// runtime resolves a tool call synchronously, so `inProgress`/`executing` are only reachable by
// rendering the component directly with an explicit status, never through a story's play.
describe('toolCallLine', () => {
  it('renders the DOM contract and the in-progress label for `inProgress`', async () => {
    const screen = await render(
      <ToolCallLine
        name="lookupLoyaltyBalance"
        args={{ programme: 'Marriott Bonvoy' }}
        status="inProgress"
        result={undefined}
      />,
    )

    const line = screen.getByTestId('chat-tool-call')

    await expect.element(line).toHaveAttribute('data-tool-name', 'lookupLoyaltyBalance')
    await expect.element(line).toHaveAttribute('data-tool-status', 'inProgress')
    await expect.element(line).toHaveAttribute('role', 'status')
    await expect.element(line).toHaveAttribute('aria-live', 'polite')
    await expect.element(line).toHaveTextContent('Looking up lookup loyalty balance…')
  })

  it('renders the same in-progress label for `executing`', async () => {
    const screen = await render(
      <ToolCallLine name="lookupLoyaltyBalance" args={{}} status="executing" result={undefined} />,
    )

    await expect.element(screen.getByTestId('chat-tool-call')).toHaveAttribute('data-tool-status', 'executing')
    await expect.element(screen.getByTestId('chat-tool-call')).toHaveTextContent('Looking up lookup loyalty balance…')
  })

  it('renders the complete label without leaking the result', async () => {
    const screen = await render(
      <ToolCallLine
        name="hotels_search"
        args={{ city: 'Bangkok' }}
        status="complete"
        result={JSON.stringify({ points: 128000 })}
      />,
    )

    const line = screen.getByTestId('chat-tool-call')

    await expect.element(line).toHaveAttribute('data-tool-status', 'complete')
    await expect.element(line).toHaveTextContent('Checked hotels search')
    await expect.element(line).not.toHaveTextContent('128000')
  })

  it('lets a consumer re-word both templates without the package supplying its own copy', async () => {
    const screen = await render(
      <ToolCallLine
        name="loyalty_facts"
        args={{}}
        status="inProgress"
        result={undefined}
        labels={{
          inProgress: (name) => {
            return `Working on ${name}`
          },
        }}
      />,
    )

    await expect.element(screen.getByTestId('chat-tool-call')).toHaveTextContent('Working on loyalty facts')
  })

  it('appends a consumer className after the defaults', async () => {
    const screen = await render(
      <ToolCallLine name="x" args={{}} status="complete" result={undefined} className="mt-2" />,
    )

    await expect.element(screen.getByTestId('chat-tool-call')).toHaveClass('mt-2')
  })
})
