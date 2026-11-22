import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { AgentProgressLine } from '../components/agent-progress-line.js'

// The DOM contract and copy per phase; the run-status gate lives in the renderer and is asserted
// end to end in context.test.tsx.
describe('agentProgressLine', () => {
  it('renders the DOM contract with the thinking copy and the step budget', async () => {
    const screen = await render(<AgentProgressLine phase="thinking" step={1} maxSteps={5} tools={[]} />)
    const line = screen.getByTestId('chat-agent-progress')

    await expect.element(line).toHaveAttribute('data-phase', 'thinking')
    await expect.element(line).toHaveAttribute('data-step', '1')
    await expect.element(line).toHaveAttribute('role', 'status')
    await expect.element(line).toHaveAttribute('aria-live', 'polite')
    await expect.element(screen.getByText('Thinking…')).toBeVisible()
    await expect.element(screen.getByText('Step 1 of up to 5')).toBeVisible()
  })

  it('names the tools being looked up, humanised, and says so before the first one starts', async () => {
    const screen = await render(
      <AgentProgressLine phase="researching" step={2} maxSteps={5} tools={['hotels_search', 'hotelDetail']} />,
    )

    await expect.element(screen.getByText('Looking up: hotels search, hotel detail…')).toBeVisible()

    await screen.rerender(<AgentProgressLine phase="researching" step={2} maxSteps={5} tools={[]} />)

    await expect.element(screen.getByText('Looking things up…')).toBeVisible()
  })

  it('renders the answering copy', async () => {
    const screen = await render(<AgentProgressLine phase="answering" step={3} maxSteps={5} tools={[]} />)

    await expect.element(screen.getByText('Writing the answer…')).toBeVisible()
  })

  it('renders nothing once the run is done', async () => {
    const screen = await render(<AgentProgressLine phase="done" step={3} maxSteps={5} tools={[]} />)

    await expect.element(screen.getByTestId('chat-agent-progress')).not.toBeInTheDocument()
  })

  it('lets a consumer re-word every template', async () => {
    const screen = await render(
      <AgentProgressLine
        phase="researching"
        step={2}
        maxSteps={5}
        tools={['loyalty_facts']}
        labels={{
          researching: (tools) => {
            return `Checking ${tools.join(' and ')}`
          },
          step: (step, maxSteps) => {
            return `${step}/${maxSteps}`
          },
        }}
      />,
    )

    await expect.element(screen.getByText('Checking loyalty facts')).toBeVisible()
    await expect.element(screen.getByText('2/5')).toBeVisible()
  })
  it('lets a consumer word each tool before the template sees it', async () => {
    const screen = await render(
      <AgentProgressLine
        phase="researching"
        step={2}
        maxSteps={5}
        tools={['live_hotels_search', 'web_read']}
        labels={{
          toolName: (name) => {
            return name === 'web_read' ? "Reading the hotel's page" : 'Checking live prices'
          },
          researching: (tools) => {
            return `${tools.join(' · ')}…`
          },
        }}
      />,
    )

    await expect.element(screen.getByText("Checking live prices · Reading the hotel's page…")).toBeVisible()
  })
})
