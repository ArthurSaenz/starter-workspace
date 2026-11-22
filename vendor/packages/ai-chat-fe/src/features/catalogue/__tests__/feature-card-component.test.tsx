import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { FeatureCardComponent } from '../components/feature-card-component.js'
import type { Feature } from '../types.js'

const onFeature: Feature = {
  id: 'copy.labels',
  area: 'surfaces',
  title: 'Labels',
  summary: 'All user-facing copy',
  status: 'on',
  seam: { kind: 'chat', prop: 'labels' },
  stories: ['PlaceholderAndWelcome'],
  docs: '',
}

const blockedFeature: Feature = {
  id: 'messages.reasoning',
  area: 'messages',
  title: 'Reasoning messages',
  summary: 'Collapsible thinking block',
  status: 'backend-blocked',
  blockedBy: ['lambda-backend'],
  seam: { kind: 'chat', prop: 'messageView', path: 'reasoningMessage' },
  stories: ['FakeOnly_ReasoningCollapsible'],
  docs: '',
  caveat: 'Needs the adapter.',
}

describe('featureCardComponent', () => {
  it('shows the status badge and the seam, and nothing about blockers or the fake', async () => {
    const screen = await render(<FeatureCardComponent feature={onFeature} />)

    await expect.element(screen.getByTestId('catalogue-status')).toHaveAttribute('data-status', 'on')
    await expect.element(screen.getByTestId('catalogue-seam')).toHaveTextContent('chat.labels')
    expect(screen.getByTestId('catalogue-blocked-by').elements()).toHaveLength(0)
    expect(screen.getByTestId('catalogue-fake-only').elements()).toHaveLength(0)
  })

  it('lists the blockers, the caveat and the FakeOnly banner when the fake supplies something', async () => {
    const screen = await render(
      <FeatureCardComponent feature={blockedFeature} fakeSupplies={['THINKING_START', 'THINKING_END']} />,
    )

    await expect.element(screen.getByTestId('catalogue-blocked-by')).toHaveTextContent('lambda-backend')
    await expect.element(screen.getByTestId('catalogue-seam')).toHaveTextContent('chat.messageView.reasoningMessage')
    await expect.element(screen.getByText('Needs the adapter.')).toBeVisible()
    await expect.element(screen.getByRole('note')).toMatchTextContent(/supplies: THINKING_START, THINKING_END$/)
  })

  it('shows the denied-route banner when the story exercises a route the Lambda 404s', async () => {
    const screen = await render(<FeatureCardComponent feature={blockedFeature} deniedRoute="/threads" />)

    await expect.element(screen.getByTestId('catalogue-denied-route')).toMatchTextContent(/404 on \/threads$/)
    expect(screen.getByTestId('catalogue-fake-only').elements()).toHaveLength(0)
  })

  it('keeps the banner off for an empty fakeSupplies and appends a consumer className', async () => {
    const screen = await render(<FeatureCardComponent feature={blockedFeature} fakeSupplies={[]} className="mt-2" />)

    expect(screen.getByTestId('catalogue-fake-only').elements()).toHaveLength(0)
    await expect
      .element(screen.getByTestId('catalogue-feature-card'))
      .toHaveAttribute('class', 'rounded-md border border-gray-200 p-4 text-sm mt-2')
  })
})
